// connection_service.go — ConnectionService (W7): трекер активных
// соединений за интерфейсом ConnectionTracker (clash-api инстанса —
// W8-релиз; тесты — детерминированный трекер). List/Watch/Close.
package api

import (
	"context"
	"strings"
	"time"

	"connectrpc.com/connect"
	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
)

// ConnInfo — модель соединения трекера (источник-агностик).
type ConnInfo struct {
	ID          string
	StartedAtMs int64
	EndedAtMs   int64 // 0 = активно
	Outbound    string
	Destination string
	Resolved    string
	Inbound     string
	Rule        string
	Process     string
	Upload      int64
	Download    int64
}

// ConnectionTracker — источник соединений (W8: clash-api; тесты: память).
type ConnectionTracker interface {
	List() []ConnInfo
	Close(id string) error
	// Subscribe — канал изменений (закрытия); cancel отписывает.
	Subscribe() (<-chan string, func())
}

func connToProto(c ConnInfo) *lavrayv1.Connection {
	out := &lavrayv1.Connection{
		Id:          c.ID,
		StartedAtMs: c.StartedAtMs,
		Outbound:    c.Outbound,
		Destination: c.Destination,
		Status:      lavrayv1.Connection_STATUS_ACTIVE,
	}
	_ = c.Upload
	_ = c.Download // трафик соединения — в Connection нет полей; считаем в Stats (W8 clash-api даёт готовые суммы)
	if c.EndedAtMs != 0 {
		out.Status = lavrayv1.Connection_STATUS_CLOSED
		out.EndedAtMs = int64p(c.EndedAtMs)
	}
	if c.Resolved != "" {
		out.ResolvedDestination = strpIf(c.Resolved)
	}
	if c.Inbound != "" {
		out.Inbound = strpIf(c.Inbound)
	}
	if c.Rule != "" {
		out.Rule = strpIf(c.Rule)
	}
	if c.Process != "" {
		out.Process = strpIf(c.Process)
	}
	return out
}

func (s *Server) connTracker() ConnectionTracker { return s.conns }

func (s *Server) ListConnections(ctx context.Context, req *connect.Request[lavrayv1.ListConnectionsRequest]) (*connect.Response[lavrayv1.ListConnectionsResponse], error) {
	tr := s.connTracker()
	if tr == nil {
		return nil, failedPrecondition("трекер соединений не сконфигурирован (clash-api — W8)")
	}
	msg := req.Msg
	outFilter := strings.ToLower(optStr(msg.OutboundFilter))
	dstFilter := strings.ToLower(optStr(msg.DestinationFilter))
	all := tr.List()
	// Активные — первыми, затем недавние закрытые (свежесть по EndedAt).
	active := make([]*lavrayv1.Connection, 0, len(all))
	var closed []*lavrayv1.Connection
	for _, c := range all {
		p := connToProto(c)
		if outFilter != "" && !strings.Contains(strings.ToLower(p.Outbound), outFilter) {
			continue
		}
		if dstFilter != "" && !strings.Contains(strings.ToLower(p.Destination), dstFilter) {
			continue
		}
		if p.Status == lavrayv1.Connection_STATUS_ACTIVE {
			active = append(active, p)
		} else {
			closed = append(closed, p)
		}
	}
	_ = time.Now // сортировка закрытых по времени — при появлении реального источника
	offset, limit := pageOf(msg.Page, int64(len(active)+len(closed)))
	items := append(active, closed...)
	if offset > int64(len(items)) {
		offset = int64(len(items))
	}
	end := int64(len(items))
	if limit >= 0 && offset+limit < end {
		end = offset + limit
	}
	items = items[offset:end]
	return connect.NewResponse(&lavrayv1.ListConnectionsResponse{Connections: items}), nil
}

func (s *Server) WatchConnections(ctx context.Context, req *connect.Request[lavrayv1.WatchConnectionsRequest], stream *connect.ServerStream[lavrayv1.ConnectionSnapshot]) error {
	tr := s.connTracker()
	if tr == nil {
		return failedPrecondition("трекер соединений не сконфигурирован")
	}
	events, cancel := tr.Subscribe()
	defer cancel()
	// Первый кадр — полный список активных.
	var active []*lavrayv1.Connection
	for _, c := range tr.List() {
		if c.EndedAtMs == 0 {
			active = append(active, connToProto(c))
		}
	}
	if err := stream.Send(&lavrayv1.ConnectionSnapshot{Active: active}); err != nil {
		return err
	}
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	closedSeen := map[string]bool{}
	for {
		select {
		case <-ctx.Done():
			return nil
		case id, ok := <-events:
			if !ok {
				return nil
			}
			closedSeen[id] = true
		case <-tick.C:
			if len(closedSeen) == 0 {
				continue
			}
			var ids []string
			for id := range closedSeen {
				ids = append(ids, id)
				delete(closedSeen, id)
			}
			if err := stream.Send(&lavrayv1.ConnectionSnapshot{ClosedIds: ids}); err != nil {
				return err
			}
		}
	}
}

func (s *Server) CloseConnection(ctx context.Context, req *connect.Request[lavrayv1.CloseConnectionRequest]) (*connect.Response[lavrayv1.Empty], error) {
	tr := s.connTracker()
	if tr == nil {
		return nil, failedPrecondition("трекер соединений не сконфигурирован")
	}
	if err := tr.Close(req.Msg.Id); err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(&lavrayv1.Empty{}), nil
}
