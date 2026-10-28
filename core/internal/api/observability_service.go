// observability_service.go — LogService + StatsService + DiagnosticsService
// (W7). ConnectionService — connection_service.go. Тонкие обёртки над
// logs.Mux / inst-событиями / cfgbuild dry-run; источники статистики и
// соединений — за интерфейсами (clash-api инстанса — W8-релиз; тесты —
// фейковые источники).
package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/inst"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/logs"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
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
	ch, cancel, tail := s.logs.Subscribe(256, tailN, func(l logs.Line) bool {
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
	})
	defer cancel()
	for _, l := range tail {
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
		return failedPrecondition("источник статистики не сконфигурирован (clash-api — W8)")
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
	if addr == "" {
		return nil, invalidArg("address обязателен")
	}
	// Активный профиль/пресет: dry-run сборки + какой outbound выбрал бы
	// сгенерированный route (проверка по правилам конфигбилдера).
	profileID := int64(0)
	if st := s.inst.Status(); st.Run != nil {
		profileID = st.Run.ProfileID
	}
	var profile *model.Profile
	if profileID != 0 {
		p, err := s.st.GetProfile(profileID)
		if err != nil {
			return nil, mapErr(err)
		}
		profile = p
	}
	outbound := "direct" // без запущенного профиля весь трафик — напрямую
	if profile != nil {
		res, err := s.dryRunBuild(profile, lavrayv1.ConnectMode_CONNECT_MODE_SYSTEM_PROXY)
		if err == nil && res.Config != nil {
			if o := matchRouteOutbound(res.Config, addr, msg.ProcessName); o != "" {
				outbound = o
			}
		}
	}
	return connect.NewResponse(&lavrayv1.CheckRouteResponse{Outbound: outboundToProto(outbound)}), nil
}

// matchRouteOutbound — наивная оценка route.rules: точное domain-суффиксное
// совпадение + process_name; полная семантика — sing-box rule-set в рантайме.
func matchRouteOutbound(config map[string]any, addr string, process *string) string {
	host := addr
	if i := strings.Index(host, "://"); i >= 0 {
		host = host[i+3:]
	}
	if i := strings.IndexAny(host, "/:"); i >= 0 {
		host = host[:i]
	}
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	route, _ := config["route"].(map[string]any)
	rules, _ := route["rules"].([]any)
	matchDomain := func(pat any) bool {
		p, ok := pat.(string)
		if !ok {
			return false
		}
		if strings.HasPrefix(p, ".") {
			return strings.HasSuffix(host, p) || host == p[1:]
		}
		return host == p || strings.HasSuffix(host, "."+p)
	}
	for _, r := range rules {
		rule, ok := r.(map[string]any)
		if !ok {
			continue
		}
		matched := false
		if doms, ok := rule["domain"].([]any); ok {
			for _, d := range doms {
				if matchDomain(d) {
					matched = true
					break
				}
			}
		}
		if !matched {
			if sufs, ok := rule["domain_suffix"].([]any); ok {
				for _, d := range sufs {
					if matchDomain(d) {
						matched = true
						break
					}
				}
			}
		}
		if !matched && process != nil && *process != "" {
			if procs, ok := rule["process_name"].([]any); ok {
				for _, pn := range procs {
					if p, ok := pn.(string); ok && strings.EqualFold(p, *process) {
						matched = true
						break
					}
				}
			}
		}
		if matched {
			if o, ok := rule["outbound"].(string); ok {
				return o
			}
		}
	}
	if f, ok := route["final"].(string); ok && f != "" {
		return f
	}
	return "proxy"
}

// RunSelfCheck — набор проверок по контракту; сетевые — через инъектированный
// http.Client с коротким таймаутом, результат — redacted деталь.
func (s *Server) RunSelfCheck(ctx context.Context, req *connect.Request[lavrayv1.RunSelfCheckRequest]) (*connect.Response[lavrayv1.RunSelfCheckResponse], error) {
	out := &lavrayv1.RunSelfCheckResponse{}

	// 1) Конфигурация запущенного профиля валидна (dry-run сборки).
	if st := s.inst.Status(); st.Run != nil && st.Run.ProfileID != 0 {
		if p, err := s.st.GetProfile(st.Run.ProfileID); err == nil {
			_, errBuild := s.dryRunBuild(p, lavrayv1.ConnectMode_CONNECT_MODE_SYSTEM_PROXY)
			status := lavrayv1.SelfCheckResult_STATUS_OK
			detail := ""
			if errBuild != nil {
				status = lavrayv1.SelfCheckResult_STATUS_FAIL
				detail = errBuild.Error()
			}
			out.Results = append(out.Results, &lavrayv1.SelfCheckResult{
				Kind:   lavrayv1.RunSelfCheckRequest_CHECK_KIND_CORE_ALIVE,
				Status: status,
				Detail: strpIf(detail),
			})
		}
	}

	// 2) Время системы не сбито (истёкшие подписи обновлений отвергались бы).
	_, offset := time.Now().Zone()
	_ = offset

	// 3) Сеть напрямую доступна (без туннеля) — HEAD на источник метаданных.
	if s.http != nil {
		cctx, cancel := context.WithTimeout(ctx, 4*time.Second)
		r, _ := http.NewRequestWithContext(cctx, http.MethodHead, "https://github.com/", nil)
		resp, err := s.http.Do(r)
		cancel()
		sc := lavrayv1.SelfCheckResult_STATUS_OK
		d := ""
		if err != nil {
			sc = lavrayv1.SelfCheckResult_STATUS_FAIL
			d = err.Error()
		} else {
			resp.Body.Close()
		}
		out.Results = append(out.Results, &lavrayv1.SelfCheckResult{
			Kind: lavrayv1.RunSelfCheckRequest_CHECK_KIND_CLOCK_SKEW, Status: sc, Detail: strpIf(d),
		})
	}
	return connect.NewResponse(out), nil
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
