package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/cfgbuild"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	lavrayv1connect "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1connect"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/inst"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/logs"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/presets"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/subs"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// Deps — зависимости сервера (все внедряются: cmd/lavray-core в W8, тесты —
// httptest + FakeRunner).
type Deps struct {
	Store  *store.Store // обязателен
	Logs   *logs.Mux    // nil → свой на 1000 строк
	Runner inst.Runner  // nil → inst.NopRunner (сборка без singbox_run)
	HTTP   *http.Client // клиент подписок (туннель sub_use_proxy соберёт cmd; nil → дефолт)
}

// Server — реализация сервисов W6. Один экземпляр на процесс; горутинно-
// безопасен (хранилище сериализует транзакции, менеджер — FSM).
type Server struct {
	st   *store.Store
	logs *logs.Mux
	inst *inst.Manager
	http *http.Client

	// OnShutdown вызывается после остановки инстанса при CoreService.Shutdown
	// (W8 headless подставит выход из процесса; здесь — только остановка).
	OnShutdown func(ctx context.Context)

	// appVersion — версия приложения (оболочка сообщает при старте);
	// updater — TUF-lite клиент (nil до конфигурации обвязкой W8-релиза);
	// traffic — источник мгновенной статистики (clash-api — W8-релиз);
	// conns — трекер соединений (clash-api — W8-релиз).
	appVersion string
	updater    *updates.Client
	traffic    TrafficSource
	conns      ConnectionTracker

	// ---- подписки: прогресс-мультиплексирование по group_id ----
	subsMu      sync.Mutex
	subsRunning map[int64]bool           // бегущие UpdateSubscription → ALREADY_EXISTS
	subsSnap    map[int64]*subs.Snapshot // последний успешный снапшот (Rollback)

	// ---- SettingsService: поток изменений ----
	setMu   sync.Mutex
	setSubs map[chan *lavrayv1.SettingsChanged]struct{}
}

// NewServer создаёт сервер зависимостями (Deps.Store обязателен).
func NewServer(d Deps) *Server {
	if d.Store == nil {
		panic("api: Deps.Store обязателен")
	}
	lg := d.Logs
	if lg == nil {
		lg = logs.NewMux(1000)
	}
	httpc := d.HTTP
	if httpc == nil {
		httpc = &http.Client{Timeout: subs.DefaultOverallTimeout}
	}
	return &Server{
		st:          d.Store,
		logs:        lg,
		inst:        inst.NewManager(d.Runner),
		http:        httpc,
		subsRunning: map[int64]bool{},
		subsSnap:    map[int64]*subs.Snapshot{},
		setSubs:     map[chan *lavrayv1.SettingsChanged]struct{}{},
	}
}

// HandlerOptions — опции всех хендлеров (интерсептор recover+map).
func (s *Server) HandlerOptions() []connect.HandlerOption {
	return []connect.HandlerOption{
		connect.WithInterceptors(newInterceptor(s.logs)),
	}
}

// Register монтирует все 13 сервисов на mux: 6 реализованы (W6), 7 —
// заглушки unimplemented (W7/W8: Log/Stats/Connections/Diagnostics/Gateway/
// Updates/WebSession), чтобы сервер поднимался целиком.
func (s *Server) Register(mux *http.ServeMux) {
	opts := s.HandlerOptions()
	mount := func(path string, h http.Handler) {
		mux.Handle(path, corsWrap(h))
	}
	path, h := lavrayv1connect.NewCoreServiceHandler(s, opts...)
	mount(path, h)
	path, h = lavrayv1connect.NewProfileServiceHandler(s, opts...)
	mount(path, h)
	path, h = lavrayv1connect.NewSubscriptionServiceHandler(s, opts...)
	mount(path, h)
	path, h = lavrayv1connect.NewRoutingServiceHandler(s, opts...)
	mount(path, h)
	path, h = lavrayv1connect.NewDnsServiceHandler(s, opts...)
	mount(path, h)
	path, h = lavrayv1connect.NewSettingsServiceHandler(s, opts...)
	mount(path, h)
	// W7/W8: заглушки — контракт доступен, методы отвечают UNIMPLEMENTED.
	path, h = lavrayv1connect.NewLogServiceHandler(s, opts...)
	mount(path, h)
	path, h = lavrayv1connect.NewStatsServiceHandler(statsSvc{s}, opts...)
	mount(path, h)
	path, h = lavrayv1connect.NewConnectionServiceHandler(s, opts...)
	mount(path, h)
	path, h = lavrayv1connect.NewDiagnosticsServiceHandler(s, opts...)
	mount(path, h)
	path, h = lavrayv1connect.NewGatewayServiceHandler(lavrayv1connect.UnimplementedGatewayServiceHandler{}, opts...)
	mount(path, h)
	path, h = lavrayv1connect.NewUpdateServiceHandler(lavrayv1connect.UnimplementedUpdateServiceHandler{}, opts...)
	mount(path, h)
	path, h = lavrayv1connect.NewWebSessionServiceHandler(lavrayv1connect.UnimplementedWebSessionServiceHandler{}, opts...)
	mount(path, h)
}

// NewHandler — готовый http.Handler со всеми сервисами (хелпер для cmd/тестов).
func (s *Server) NewHandler() http.Handler {
	mux := http.NewServeMux()
	s.Register(mux)
	return mux
}

// Close — очистка при завершении процесса (подписки стримов закрывает ctx).
func (s *Server) Close() error { return nil }

// ============================================================================
// Хелперы настроек (таблица settings + дескрипторы model.SettingDescriptors)
// ============================================================================

// descriptorMap — каталог ключей (собирается один раз).
var descriptorMap = func() map[string]model.SettingDescriptor {
	m := map[string]model.SettingDescriptor{}
	for _, d := range model.SettingDescriptors() {
		m[d.Key] = d
	}
	return m
}()

// settingJSON — значение ключа из таблицы settings или дефолт дескриптора
// ("" если ключа нет вообще — такого не бывает для известных ключей).
func (s *Server) settingJSON(key string) string {
	if v, ok, err := s.st.GetSetting(key); err == nil && ok {
		return v
	}
	if d, found := descriptorMap[key]; found {
		return d.DefaultValue
	}
	return ""
}

func (s *Server) settingStr(key string) string {
	var v string
	if json.Unmarshal([]byte(s.settingJSON(key)), &v) == nil {
		return v
	}
	return ""
}

func (s *Server) settingInt(key string) int {
	var v int
	if json.Unmarshal([]byte(s.settingJSON(key)), &v) == nil {
		return v
	}
	return 0
}

func (s *Server) settingBool(key string) bool {
	var v bool
	if json.Unmarshal([]byte(s.settingJSON(key)), &v) == nil {
		return v
	}
	return false
}

// settingStringList — список строк (remember.modes, ui.log_ignore).
func (s *Server) settingStringList(key string) []string {
	var v []string
	if json.Unmarshal([]byte(s.settingJSON(key)), &v) == nil {
		return v
	}
	return nil
}

// ============================================================================
// Сборка cfgbuild.BuildSettings из карты настроек
// ============================================================================

func (s *Server) buildSettings(tunMode bool) *cfgbuild.BuildSettings {
	st := cfgbuild.DefaultSettings()
	st.Inbound = cfgbuild.InboundSettings{
		Address:           s.settingStr("inbound.address"),
		Port:              s.settingInt("inbound.port"),
		AuthUser:          s.settingStr("inbound.auth.user"),
		AuthPass:          s.settingStr("inbound.auth.pass"),
		CustomInboundJSON: s.settingStr("inbound.custom_inbound"),
	}
	st.Tun = cfgbuild.TunSettings{
		Enabled:       tunMode || s.settingBool("tun.enabled"),
		InterfaceName: s.settingStr("tun.interface_name"),
		MTU:           s.settingInt("tun.mtu"),
		Stack:         tunStackOf(s.settingInt("tun.impl")),
		StrictRoute:   s.settingBool("tun.strict_route"),
		IPv6:          s.settingBool("tun.ipv6"),
		FakeDNS:       s.settingBool("tun.fake_dns"),
		BypassProcess: s.settingStr("tun.bypass_process"),
		BypassCIDR:    s.settingStr("tun.bypass_cidr"),
		Whitelist:     s.settingBool("tun.whitelist"),
		KillSwitch:    s.settingBool("tun.kill_switch"),
	}
	st.Mux = cfgbuild.MuxSettings{
		Protocol:    s.settingStr("mux.protocol"),
		Concurrency: s.settingInt("mux.concurrency"),
		Padding:     s.settingBool("mux.padding"),
		DefaultOn:   s.settingBool("mux.default_on"),
	}
	st.AllowInsecureDefault = s.settingBool("security.allow_insecure_default")
	if v := s.settingStr("core.underlying_dns"); v != "" {
		st.UnderlyingDNS = v
	}
	st.CustomRouteGlobalJSON = s.settingStr("routing.custom_global")
	st.GeoDir = filepath.ToSlash(filepath.Join(s.st.Dir(), "geo"))
	st.CacheFilePath = filepath.ToSlash(filepath.Join(s.st.Dir(), "cache.db"))
	return st
}

// tunStackOf — vpn_impl некора: 1 gvisor (default) | 2 system | 3 mixed.
func tunStackOf(impl int) string {
	switch impl {
	case 2:
		return "system"
	case 3:
		return "mixed"
	}
	return "gvisor"
}

// validateInboundLAN — FR-UI-279/LNB-33: inbound-адрес не loopback при пустой
// авторизации → INVALID_ARGUMENT («пароль обязателен при доступе из LAN»).
// В TUN-режиме mixed-слушателя нет — проверка не нужна.
func (s *Server) validateInboundLAN(inbound cfgbuild.InboundSettings) error {
	addr := strings.TrimSpace(inbound.Address)
	if addr == "" || addr == "localhost" {
		return nil
	}
	if ip := net.ParseIP(addr); ip != nil && ip.IsLoopback() {
		return nil
	}
	if inbound.AuthUser == "" || inbound.AuthPass == "" {
		return invalidArg("inbound.address: адрес %s не loopback — авторизация (inbound.auth.user/pass) обязательна при доступе из LAN (FR-UI-279)", addr)
	}
	return nil
}

// ============================================================================
// Пресеты: builtin (presets.BuiltinPresets) + пользовательские (meta)
// ============================================================================

const (
	metaCustomPresets   = "routing.custom_presets" // JSON []presets.Preset
	metaDNSOverride     = "routing.dns_override"   // JSON presets.DNSBlock (для builtin-активного)
	settingActivePreset = "routing.active_preset"
)

// activePresetID — id активного набора (дефолт дескриптора — "lav-global").
func (s *Server) activePresetID() string {
	if v := s.settingStr(settingActivePreset); v != "" {
		return v
	}
	return "lav-global"
}

// customPresets — пользовательские наборы (хранятся в meta одним JSON).
func (s *Server) customPresets() ([]*presets.Preset, error) {
	raw, ok, err := s.st.GetMeta(metaCustomPresets)
	if err != nil {
		return nil, err
	}
	if !ok || strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var out []*presets.Preset
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, fmt.Errorf("api: чтение пользовательских пресетов: %w", err)
	}
	return out, nil
}

func (s *Server) saveCustomPresets(list []*presets.Preset) error {
	b, err := json.Marshal(list)
	if err != nil {
		return err
	}
	return s.st.SetMeta(metaCustomPresets, string(b))
}

// findPreset — builtin или пользовательский по id.
func (s *Server) findPreset(id string) (*presets.Preset, bool, error) {
	if id == "" {
		return nil, false, nil
	}
	if builtin, err := presets.BuiltinPresets(); err == nil {
		for _, p := range builtin {
			if p.ID == id {
				return p, true, nil
			}
		}
	} else {
		return nil, false, err
	}
	custom, err := s.customPresets()
	if err != nil {
		return nil, false, err
	}
	for _, p := range custom {
		if p.ID == id {
			return p, true, nil
		}
	}
	return nil, false, nil
}

// activePreset — активный набор (builtin, пользовательский или нейтральный).
func (s *Server) activePreset() (*presets.Preset, error) {
	p, found, err := s.findPreset(s.activePresetID())
	if err != nil {
		return nil, err
	}
	if !found {
		// настройка указывает на удалённый пресет — конфигбилдер подставит
		// нейтральный (nil)
		return nil, nil
	}
	return p, nil
}

// dnsOverride — DNS-переопределение для builtin-активного пресета
// (DnsService.SetDns; пользовательские пресеты хранят DNS в себе).
func (s *Server) dnsOverride() (*presets.DNSBlock, error) {
	raw, ok, err := s.st.GetMeta(metaDNSOverride)
	if err != nil || !ok || strings.TrimSpace(raw) == "" {
		return nil, err
	}
	var d presets.DNSBlock
	if err := json.Unmarshal([]byte(raw), &d); err != nil {
		return nil, fmt.Errorf("api: чтение DNS-переопределения: %w", err)
	}
	return &d, nil
}

// ============================================================================
// CoreStatus
// ============================================================================

func coreStateOf(st inst.State) lavrayv1.CoreState {
	switch st {
	case inst.StateStarting:
		return lavrayv1.CoreState_CORE_STATE_CONNECTING
	case inst.StateReady:
		return lavrayv1.CoreState_CORE_STATE_CONNECTED
	case inst.StateStopping:
		return lavrayv1.CoreState_CORE_STATE_DISCONNECTING
	case inst.StateCrashed:
		return lavrayv1.CoreState_CORE_STATE_ERROR
	}
	return lavrayv1.CoreState_CORE_STATE_IDLE
}

func connectModeOf(mode string) lavrayv1.ConnectMode {
	switch mode {
	case "tun":
		return lavrayv1.ConnectMode_CONNECT_MODE_TUN
	case "gateway_tproxy":
		return lavrayv1.ConnectMode_CONNECT_MODE_GATEWAY_TPROXY
	case "gateway_tun":
		return lavrayv1.ConnectMode_CONNECT_MODE_GATEWAY_TUN
	}
	return lavrayv1.ConnectMode_CONNECT_MODE_SYSTEM_PROXY
}

// coreStatus — снимок CoreStatus (менеджер + настройки inbound/tun/пресет).
func (s *Server) coreStatus() *lavrayv1.CoreStatus {
	st := s.inst.Status()
	cs := &lavrayv1.CoreStatus{
		State:           coreStateOf(st.State),
		CoreVersion:     inst.CoreVersion,
		Mode:            connectModeOf(""),
		RoutingPresetId: strpIf(s.activePresetID()),
	}
	if st.LastError != "" {
		cs.LastError = strp(st.LastError)
	}
	if st.Run != nil {
		if st.Run.ProfileID != 0 {
			cs.ActiveProfileId = int64p(st.Run.ProfileID)
		}
		if st.Run.GroupID != 0 {
			cs.ActiveGroupId = int64p(st.Run.GroupID)
		}
		if st.Run.ProfileName != "" {
			cs.ActiveProfileName = strp(st.Run.ProfileName)
		}
		cs.Mode = connectModeOf(st.Run.Mode)
		if st.Run.StartedAtMs != 0 {
			cs.StartedAtMs = int64p(st.Run.StartedAtMs)
		}
	}
	inb := s.buildSettings(false).Inbound
	cs.Inbound = &lavrayv1.InboundInfo{
		Listen:      inb.Address,
		Port:        int32(inb.Port),
		AuthEnabled: inb.AuthUser != "" && inb.AuthPass != "",
	}
	tun := s.buildSettings(false).Tun
	cs.Tun = &lavrayv1.TunInfo{Enabled: tun.Enabled}
	if tun.InterfaceName != "" {
		cs.Tun.InterfaceName = strp(tun.InterfaceName)
	}
	return cs
}

// nowMs — время для стримов (выделено для будущих тест-инъекций).
func nowMs() int64 { return time.Now().UnixMilli() }

// corsWrap — CORS для Tauri-окна: webview отдаёт страницу с origin
// tauri://localhost (или http://tauri.localhost на Windows), а ядро живёт на
// http://127.0.0.1:<port> — это кросс-оригин запрос. Разрешаем только
// локальные origin'ы оболочки и веб-панели; Bearer-токен остаётся
// обязательным (CORS — не аутентификация).
func corsWrap(next http.Handler) http.Handler {
	allowed := map[string]bool{
		"tauri://localhost":       true,
		"http://tauri.localhost":  true,
		"https://tauri.localhost": true,
		"http://localhost:1420":   true, // vite dev
		"http://127.0.0.1:1420":   true,
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && (allowed[origin] || strings.HasPrefix(origin, "http://127.0.0.1:") || strings.HasPrefix(origin, "http://localhost:")) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Connect-Protocol-Version, Connect-Timeout-Ms, X-LAVRay-CSRF")
			w.Header().Set("Access-Control-Expose-Headers", "Connect-Content-Encoding")
			w.Header().Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
