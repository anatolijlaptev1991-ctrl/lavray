// SPDX-License-Identifier: GPL-3.0-only

package api

// conn_watch.go — WatchConnections (T-79): каждый кадр — полный список
// активных соединений (до active_page_limit, сначала новые), закрытые с
// прошлого кадра и признак усечения. Кадры идут не чаще interval_ms.

import (
	"context"
	"sort"
	"time"

	"connectrpc.com/connect"

	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/traffic"
)

const (
	defaultWatchIntervalMs = 1000
	minWatchIntervalMs     = 250
	maxWatchIntervalMs     = 10000
	defaultWatchLimit      = 500
	// maxPendingClosed — сколько закрытий по событиям копится между кадрами;
	// сверх этого закрытия найдёт разность списков.
	maxPendingClosed = 10000
)

// watchInterval: не задан или 0 — 1000 мс; меньше 0 — INVALID_ARGUMENT; иначе
// значение зажимается в 250..10000 мс (слишком частые кадры — нагрузка на роутер,
// слишком редкие — зависший экран).
func watchInterval(ms *int32) (time.Duration, error) {
	v := int64(optInt32(ms))
	if v < 0 {
		return 0, invalidArg("interval_ms не может быть отрицательным")
	}
	if v == 0 {
		v = defaultWatchIntervalMs
	}
	return time.Duration(max(minWatchIntervalMs, min(v, maxWatchIntervalMs))) * time.Millisecond, nil
}

// watchLimit: не задан или 0 — 500; меньше 0 или больше 5000 — INVALID_ARGUMENT.
func watchLimit(v *int32) (int, error) {
	n := int(optInt32(v))
	if n < 0 || n > maxConnPage {
		return 0, invalidArg("active_page_limit должен быть от 0 до %d", maxConnPage)
	}
	if n == 0 {
		n = defaultWatchLimit
	}
	return n, nil
}

// connWatch — состояние одного потока: что отправлено, на какой источник
// подписан. Источник меняется при перезапуске инстанса, поток при этом живёт.
type connWatch struct {
	filter  connFilter
	limit   int
	src     traffic.Source
	events  <-chan traffic.Event
	cancel  func()
	prev    map[string]struct{} // все подходящие активные прошлого кадра
	pending map[string]struct{} // закрытия по событиям с прошлого кадра
}

func newConnWatch(msg *lavrayv1.WatchConnectionsRequest) (*connWatch, time.Duration, error) {
	interval, err := watchInterval(msg.IntervalMs)
	if err != nil {
		return nil, 0, err
	}
	limit, err := watchLimit(msg.ActivePageLimit)
	if err != nil {
		return nil, 0, err
	}
	return &connWatch{
		filter:  newConnFilter(msg.OutboundFilter, msg.DestinationFilter),
		limit:   limit,
		prev:    map[string]struct{}{},
		pending: map[string]struct{}{},
	}, interval, nil
}

// bind подписывается на src; при смене источника старая подписка снимается.
func (w *connWatch) bind(src traffic.Source) {
	if src == w.src {
		return
	}
	w.release()
	w.src = src
	if src != nil {
		w.events, w.cancel = src.Subscribe()
	}
}

// release снимает подписку.
func (w *connWatch) release() {
	if w.cancel != nil {
		w.cancel()
	}
	w.events, w.cancel, w.src = nil, nil, nil
}

// drainEvents собирает закрытия, пришедшие с прошлого кадра.
func (w *connWatch) drainEvents() {
	for {
		select {
		case ev, ok := <-w.events:
			if !ok {
				w.events = nil
				return
			}
			if ev.Kind == traffic.EventClosed && len(w.pending) < maxPendingClosed {
				w.pending[ev.ID] = struct{}{}
			}
		default:
			return
		}
	}
}

// frame строит кадр по текущему источнику (nil — инстанса нет: активных нет).
// Закрытые = исчезнувшие из списка с прошлого кадра ∪ закрытия по событиям;
// каждый id попадает ровно в один кадр.
func (w *connWatch) frame(src traffic.Source) *lavrayv1.ConnectionSnapshot {
	w.bind(src)
	w.drainEvents()
	var all []traffic.ConnInfo
	if src != nil {
		all = sortedActive(src, w.filter)
	}
	cur := make(map[string]struct{}, len(all))
	for _, c := range all {
		cur[c.ID] = struct{}{}
	}
	snap := &lavrayv1.ConnectionSnapshot{ClosedIds: w.closedIDs(cur)}
	w.prev = cur
	if len(all) > w.limit {
		all, snap.Truncated = all[:w.limit], true
	}
	for _, c := range all {
		snap.Active = append(snap.Active, connToProto(c))
	}
	return snap
}

// closedIDs — закрытия для кадра по множеству cur; сбрасывает накопленное.
func (w *connWatch) closedIDs(cur map[string]struct{}) []string {
	seen := map[string]struct{}{}
	for id := range w.prev {
		if _, alive := cur[id]; !alive {
			seen[id] = struct{}{}
		}
	}
	for id := range w.pending {
		if _, alive := cur[id]; !alive {
			seen[id] = struct{}{}
		}
	}
	clear(w.pending)
	if len(seen) == 0 {
		return nil
	}
	ids := make([]string, 0, len(seen))
	for id := range seen {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func (s *Server) WatchConnections(ctx context.Context, req *connect.Request[lavrayv1.WatchConnectionsRequest], stream *connect.ServerStream[lavrayv1.ConnectionSnapshot]) error {
	w, interval, err := newConnWatch(req.Msg)
	if err != nil {
		return err
	}
	defer w.release()
	tick := time.NewTicker(interval)
	defer tick.Stop()
	for {
		if err := stream.Send(w.frame(s.inst.Traffic())); err != nil {
			return err
		}
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
		}
	}
}
