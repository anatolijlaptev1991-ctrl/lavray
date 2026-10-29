// SPDX-License-Identifier: GPL-3.0-only

// observability_service.go — LogService + StatsService + DiagnosticsService
// (W7). ConnectionService — connection_service.go. Тонкие обёртки над
// logs.Mux / inst-событиями / cfgbuild dry-run; источники статистики и
// соединений — за интерфейсами (clash-api инстанса — W8-релиз; тесты —
// фейковые источники).
package api

import (
	"context"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/cfgbuild"
	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/inst"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/logs"
)

// ---- LogService -----------------------------------------------------------------

func logLevelToProto(l string) lavrayv1.LogLevel {
	switch l {
	case logs.LevelTrace:
		return lavrayv1.LogLevel_LOG_LEVEL_TRACE
	case logs.LevelDebug:
		return lavrayv1.LogLevel_LOG_LEVEL_DEBUG
	case logs.LevelWarn:
		return lavrayv1.LogLevel_LOG_LEVEL_WARN
	case logs.LevelError, logs.LevelPanic:
		return lavrayv1.LogLevel_LOG_LEVEL_ERROR
	default:
		return lavrayv1.LogLevel_LOG_LEVEL_INFO
	}
}

func logLineToProto(l logs.Line) *lavrayv1.LogLine {
	return &lavrayv1.LogLine{
		TsMs:    l.TsMs,
		Level:   logLevelToProto(l.Level),
		Source:  l.Source,
		Message: l.Message,
	}
}

func (s *Server) GetTail(ctx context.Context, req *connect.Request[lavrayv1.GetTailRequest]) (*connect.Response[lavrayv1.GetTailResponse], error) {
	n := int(req.Msg.Lines)
	if n <= 0 {
		n = 200
	}
	if n > 2000 {
		n = 2000
	}
	lines := s.logs.Tail(n)
	out := make([]*lavrayv1.LogLine, 0, len(lines))
	for _, l := range lines {
		out = append(out, logLineToProto(l))
	}
	return connect.NewResponse(&lavrayv1.GetTailResponse{Lines: out}), nil
}

func (s *Server) Subscribe(ctx context.Context, req *connect.Request[lavrayv1.SubscribeLogsRequest], stream *connect.ServerStream[lavrayv1.LogLine]) error {
	msg := req.Msg
	minLevel := lavrayv1.LogLevel_LOG_LEVEL_TRACE
	if msg.MinLevel != nil {
		minLevel = *msg.MinLevel
	}
	tailN := 0
	if msg.TailLines != nil {
		tailN = int(*msg.TailLines)
	}
	srcSet := map[string]bool{}
	for _, src := range msg.Sources {
		srcSet[src] = true
	}
	has := func(list []string, s string) bool {
		for _, k := range list {
			if strings.Contains(strings.ToLower(s), strings.ToLower(k)) {
				return true
			}
		}
		return false
	}
	keep := func(l logs.Line) bool {
		if logLevelToProto(l.Level) < minLevel {
			return false
		}
		if len(srcSet) > 0 && !srcSet[l.Source] {
			return false
		}
		if len(msg.ExcludeKeywords) > 0 && has(msg.ExcludeKeywords, l.Message) {
			return false
		}
		if len(msg.IncludeKeywords) > 0 && !has(msg.IncludeKeywords, l.Message) {
			return false
		}
		return true
	}
	// T-70: tail_lines — «сколько истории отдать сразу (0 = нет)». Mux.Subscribe
	// при tail <= 0 возвращает ВЕСЬ буфер, поэтому историю берём из него сами:
	// те же фильтры, что у живого потока, последние tailN подходящих строк.
	ch, cancel, ring := s.logs.Subscribe(256, 0, keep)
	defer cancel()
	for _, l := range lastMatching(ring, min(tailN, 2000), keep) {
		if err := stream.Send(logLineToProto(l)); err != nil {
			return err
		}
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		case l, ok := <-ch:
			if !ok {
				return nil
			}
			if err := stream.Send(logLineToProto(l)); err != nil {
				return err
			}
		}
	}
}

// lastMatching — последние n строк из lines (от старых к новым), прошедших keep;
// n <= 0 — пусто.
func lastMatching(lines []logs.Line, n int, keep func(logs.Line) bool) []logs.Line {
	if n <= 0 {
		return nil
	}
	var out []logs.Line
	for i := len(lines) - 1; i >= 0 && len(out) < n; i-- {
		if keep(lines[i]) {
			out = append(out, lines[i])
		}
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// ---- StatsService -----------------------------------------------------------------

// TrafficSource — источник мгновенной статистики инстанса (W8: clash-api;
// тесты — детерминированный источник).
type TrafficSource interface {
	Snapshot() (up, down int64, ok bool)
}

// statsSvc — отдельный receiver для StatsService.Subscribe (коллизия имён
// с LogService.Subscribe на одном Server).
type statsSvc struct{ *Server }

func (s statsSvc) Subscribe(ctx context.Context, req *connect.Request[lavrayv1.SubscribeStatsRequest], stream *connect.ServerStream[lavrayv1.StatsSnapshot]) error {
	if s.traffic == nil {
		return failedPrecondition("статистика трафика пока недоступна в этой версии LAVRay")
	}
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	// Финальный кадр: при остановке инстанса шлём Final и закрываем.
	events, cancelEvents := s.inst.Subscribe()
	defer cancelEvents()
	for {
		select {
		case <-ctx.Done():
			return nil
		case ev := <-events:
			if ev.Status.State == inst.StateIdle || ev.Status.State == inst.StateCrashed {
				return stream.Send(&lavrayv1.StatsSnapshot{TsMs: time.Now().UnixMilli(), Final: true})
			}
		case <-tick.C:
			up, down, ok := s.traffic.Snapshot()
			if !ok {
				continue
			}
			sess := &lavrayv1.SessionStat{UplinkTotal: up, DownlinkTotal: down}
			if err := stream.Send(&lavrayv1.StatsSnapshot{TsMs: time.Now().UnixMilli(), Session: sess}); err != nil {
				return err
			}
		}
	}
}

func (s *Server) GetTrafficTotals(ctx context.Context, req *connect.Request[lavrayv1.GetTrafficTotalsRequest]) (*connect.Response[lavrayv1.GetTrafficTotalsResponse], error) {
	profiles, err := s.st.ListProfiles(-1)
	if err != nil {
		return nil, mapErr(err)
	}
	totals := make(map[int64]*lavrayv1.TrafficCounters, len(profiles))
	for _, p := range profiles {
		totals[p.ID] = &lavrayv1.TrafficCounters{
			UplinkBytes:   p.Traffic.UplinkBytes,
			DownlinkBytes: p.Traffic.DownlinkBytes,
		}
	}
	return connect.NewResponse(&lavrayv1.GetTrafficTotalsResponse{Totals: totals}), nil
}

func (s *Server) GetTrafficSummary(ctx context.Context, req *connect.Request[lavrayv1.GetTrafficSummaryRequest]) (*connect.Response[lavrayv1.GetTrafficSummaryResponse], error) {
	return nil, errNotYetW6 // группировка по группам/подпискам — W8 (запрос к store с GROUP BY)
}

// ---- DiagnosticsService --------------------------------------------------------------

func (s *Server) CheckRoute(ctx context.Context, req *connect.Request[lavrayv1.CheckRouteRequest]) (*connect.Response[lavrayv1.CheckRouteResponse], error) {
	msg := req.Msg
	addr := strings.TrimSpace(msg.Address)
	// T-29: достаточно адреса ИЛИ имени процесса (приложение без адреса).
	proc := strings.TrimSpace(msg.GetProcessName())
	if addr == "" && proc == "" {
		return nil, invalidArg("нужен address или process_name")
	}
	// T-30: правила берутся из того же routeRules, что строит конфиг
	// (rule_set, ip_*, тег bypass); запущенный профиль не нужен. В режиме TUN
	// учитываются TUN-списки исключений.
	preset, err := s.activePreset()
	if err != nil {
		return nil, mapErr(err)
	}
	table, err := cfgbuild.BuildRouteTable(preset, s.buildSettings(s.tunnelIsTUN()))
	if err != nil {
		return nil, mapErr(err)
	}
	v := table.Evaluate(cfgbuild.ParseRouteQuery(addr, proc), s.ruleSetLookup(table))
	if len(v.Unresolved) > 0 {
		s.logs.Logf(logs.LevelWarn, logs.SourceCore, "тестер маршрута: не вычислено %v", v.Unresolved)
	}
	resp := &lavrayv1.CheckRouteResponse{Outbound: outboundToProto(v.Outbound), MatchedList: strp(v.List)}
	if v.Index >= 0 {
		resp.MatchedRule = strp(v.Rule + " → " + v.Outbound)
	}
	return connect.NewResponse(resp), nil
}

// GetPublicIp — «каков мой адрес наружу». Поле via выбирает путь запроса
// (T-16): THROUGH_TUNNEL — через mixed-in работающего инстанса (туннель не
// поднят → FAILED_PRECONDITION), DIRECT — напрямую, UNSPECIFIED — через
// туннель, если соединение активно, иначе напрямую.
func (s *Server) GetPublicIp(ctx context.Context, req *connect.Request[lavrayv1.GetPublicIpRequest]) (*connect.Response[lavrayv1.GetPublicIpResponse], error) {
	client, err := s.httpVia(req.Msg.Via)
	if err != nil {
		return nil, err
	}
	ip, err := s.fetchPublicIP(ctx, client)
	if err != nil {
		return nil, unavailable(err)
	}
	return connect.NewResponse(&lavrayv1.GetPublicIpResponse{Ip: strpIf(ip.String()), IsIpv6: ip.Is6()}), nil
}

// CheckLeaks — IP напрямую и через туннель, прямой IPv6 (FR-UI-273). Что не
// измерено, перечислено в LeakReport.unchecked: пустое поле не означает
// «в порядке». DNS-эгресс не измеряется никогда: контролируемого тест-домена,
// который показал бы адрес резолвера, у приложения нет.
func (s *Server) CheckLeaks(ctx context.Context, req *connect.Request[lavrayv1.Empty]) (*connect.Response[lavrayv1.LeakReport], error) {
	out := &lavrayv1.LeakReport{
		TunnelActive: s.inst.Status().State == inst.StateReady,
		Unchecked:    []string{"dns"},
	}
	tunnel, up := s.tunnelClient()
	if up {
		if ip, err := s.fetchPublicIP(ctx, tunnel); err == nil {
			out.TunnelIp = strpIf(ip.String())
		}
	}
	if out.TunnelIp == nil {
		out.Unchecked = append(out.Unchecked, "tunnel_ip")
	}
	if s.tunnelIsTUN() {
		out.Unchecked = append(out.Unchecked, "direct_ip", "ipv6")
		return connect.NewResponse(out), nil
	}
	if ip, err := s.fetchPublicIP(ctx, s.http); err == nil {
		out.DirectIp = strpIf(ip.String())
	} else {
		out.Unchecked = append(out.Unchecked, "direct_ip")
	}
	if up {
		out.Ipv6DirectAvailable = s.ipv6DirectAvailable(ctx)
	} else {
		out.Unchecked = append(out.Unchecked, "ipv6")
	}
	return connect.NewResponse(out), nil
}
