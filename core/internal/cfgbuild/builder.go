// Package cfgbuild — конфигбилдер LAVRay (W4: §3.4 шаги 1–3 плана
// core-port-plan.md): allowlist-мерж custom_config, outbounds из профилей
// всех типов модели, цепочки с тегами proxy/g-/c-, каркас конфига
// (log + outbounds-минимум + dns/route-заглушки под W5).
//
// Оракул порта: nekoray/db/ConfigBuilder.cpp + fmt/Bean2CoreObj_box.cpp.
package cfgbuild

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
)

// ProfileLookup — разрешение id → профиль (store.GetProfile, W6 подставит
// реализацию хранилища; в тестах — карта extra_profiles).
type ProfileLookup func(id int64) (*model.Profile, error)

// MuxSettings — глобальные настройки мультиплексирования (§3.1.10);
// дефолты соответствуют model.SettingDescriptors (mux.*).
type MuxSettings struct {
	Protocol    string `json:"protocol"`    // h2mux | smux | yamux
	Concurrency int    `json:"concurrency"` // <= 0 — мультиплексирование выключено глобально
	Padding     bool   `json:"padding"`
	DefaultOn   bool   `json:"default_on"` // multiplex_status == 0 (default) → включён?
}

// BuildSettings — параметры сборки, влияющие на конфиг (подмножество карты
// настроек; W6 заполняет из settings-хранилища).
type BuildSettings struct {
	LogLevel             string      `json:"log_level"`              // log.level (default "info")
	AllowInsecureDefault bool        `json:"allow_insecure_default"` // security.allow_insecure_default (skip_cert)
	Mux                  MuxSettings `json:"mux"`
}

// DefaultSettings — значения по умолчанию (model.SettingDescriptors).
func DefaultSettings() *BuildSettings {
	return &BuildSettings{
		LogLevel: "info",
		Mux:      MuxSettings{Protocol: "h2mux", Concurrency: -1},
	}
}

// BuildRequest — вход сборки конфига.
type BuildRequest struct {
	Profile   *model.Profile // целевой профиль (в т.ч. chain / custom)
	Group     *model.Group   // группа профиля (front_proxy_id), может быть nil
	Settings  *BuildSettings // nil → DefaultSettings
	Lookup    ProfileLookup  // обязательна для chain/front proxy
	ForTest   bool           // §3.1.9: режим теста (W5 влияет на inbounds/правила)
	ForExport bool           // §3.1.9: экспорт (W5 убирает auto_detect_interface)
}

// BuildResult — результат сборки.
type BuildResult struct {
	// Config — итоговый конфиг sing-box (map; маршалится с сортировкой
	// ключей — детерминизм golden).
	Config map[string]any

	// OutboundTag — тег «последней мили» цепочки, всегда "proxy".
	OutboundTag string

	// OutboundTags — все теги outbound'ов, созданных для профиля
	// (для allowlist-мержа custom_config → outbounds).
	OutboundTags []string

	// IgnoreConnTags — теги промежуточных outbound'ов цепочки (index != 0),
	// соединения с ними не считаются пользовательскими (оракул).
	IgnoreConnTags []string

	// ServerDomains — домены серверов цепочки («full:<домен>»), для
	// dns-direct правил W5 (§3.1.4).
	ServerDomains []string

	// ExternalCores — записи о внешних ядрах (всегда пуст в W4: внешние
	// ядра за флагом enable_external_cores, W6).
	ExternalCores []ExternalCore
}

// ExternalCore — описание внешнего ядра (заполняется только в W6 за флагом).
type ExternalCore struct {
	ProfileID int64
	Tag       string
	Command   []string
}

// Build собирает конфиг sing-box для профиля (порт BuildConfig,
// ConfigBuilder.cpp:73–92 + BuildConfigSingBox W4-часть).
func Build(req BuildRequest) (*BuildResult, error) {
	if req.Profile == nil {
		return nil, invalidArgument("profile", "profile is required")
	}
	st := req.Settings
	if st == nil {
		st = DefaultSettings()
	}
	res := &BuildResult{}

	var cfg map[string]any
	if isInternalFull(req.Profile) {
		// internal-full: конфиг «как есть» (§3.1.9), custom_config сверху
		// через allowlist.
		var err error
		cfg, err = internalFullConfig(req.Profile)
		if err != nil {
			return nil, err
		}
	} else {
		var err error
		cfg, err = buildSingBoxConfig(req, st, res)
		if err != nil {
			return nil, err
		}
	}

	// custom_config мержится ТОЛЬКО по allowlist (§3.1.1, LNB-25) и только
	// после подтверждения пользователя для импортированных профилей
	// (FR-UI-257; не подтверждённые поля отбрасывает уже парсер W3).
	if req.Profile.CustomConfigJSON != "" && req.Profile.CustomFieldsConfirmed {
		if err := MergeCustomConfig(cfg, req.Profile.CustomConfigJSON, res.OutboundTags); err != nil {
			return nil, err
		}
	}
	res.Config = cfg
	return res, nil
}

// buildSingBoxConfig — каркас + outbounds (W4); inbounds/DNS/route — W5.
func buildSingBoxConfig(req BuildRequest, st *BuildSettings, res *BuildResult) (map[string]any, error) {
	cfg := map[string]any{
		"log": map[string]any{"level": st.LogLevel},
	}

	// Цепочка (или одиночный профиль) → outbounds с тегами proxy/g-/c-.
	ents, err := resolveChain(req)
	if err != nil {
		return nil, err
	}
	outbounds, err := buildChainOutbounds(0, ents, st, res)
	if err != nil {
		return nil, err
	}

	// outbounds-минимум (оракул): direct, bypass, block.
	outbounds = append(outbounds,
		map[string]any{"type": "direct", "tag": "direct"},
		map[string]any{"type": "direct", "tag": "bypass"},
		map[string]any{"type": "block", "tag": "block"},
	)
	cfg["outbounds"] = outbounds

	// Заглушки W5: полноценные typed-DNS (§3.1.4) и route (§3.1.5) — W5.
	// Форма валидна для sing-box 1.14 и нейтральна (dns-local — сервер
	// «underlying DNS» оракула; route без правил).
	cfg["dns"] = map[string]any{
		"servers": []any{map[string]any{"tag": "dns-local", "type": "local"}},
	}
	cfg["route"] = map[string]any{"rules": []any{}}
	return cfg, nil
}

// ---- internal-full ----------------------------------------------------------

func isInternalFull(p *model.Profile) bool {
	d, ok := p.Detail.(*model.CustomDetail)
	return ok && p.Type == model.TypeCustomConfig && d.Core == "internal-full"
}

func internalFullConfig(p *model.Profile) (map[string]any, error) {
	d := p.Detail.(*model.CustomDetail)
	raw := strings.TrimSpace(d.FullConfigJSON)
	if raw == "" {
		return nil, invalidArgument("custom", "custom internal-full profile: config JSON is empty")
	}
	var cfg map[string]any
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return nil, invalidArgument("custom", "custom internal-full profile: config JSON: %v", err)
	}
	return cfg, nil
}

// ---- цепочки (порт BuildChain + BuildChainInternal) --------------------------

// resolveChain — список профилей цепочки (порядок = порядок трафика:
// ents[0] — последняя миля, ents[len-1] — вход) + групповой front proxy
// (ConfigBuilder.cpp:94–148). chain-in-chain и отсутствующие члены — ошибки.
func resolveChain(req BuildRequest) ([]*model.Profile, error) {
	lookup := func(id int64) (*model.Profile, error) {
		if req.Lookup == nil {
			return nil, failedPrecondition("chain", "profile lookup is not available")
		}
		return req.Lookup(id)
	}
	var resolveErr error
	resolve := func(ent *model.Profile) []*model.Profile {
		if ent.Type != model.TypeChain {
			return []*model.Profile{ent}
		}
		d, ok := ent.Detail.(*model.ChainDetail)
		if !ok || d == nil {
			resolveErr = invalidArgument("detail", "chain %d: missing or wrong detail type", ent.ID)
			return nil
		}
		ids := d.ProfileIDs
		resolved := make([]*model.Profile, 0, len(ids))
		// Оракул реверсирует список: хранимый порядок — сверху вниз (вход →
		// выход), порядок итерации — выход → вход.
		for i := len(ids) - 1; i >= 0; i-- {
			m, err := lookup(ids[i])
			if err != nil {
				resolveErr = err // сбой стора — не «профиль пропал» (N2)
				return nil
			}
			if m == nil {
				resolveErr = failedPrecondition("chain", "chain missing ent: %d", ids[i])
				return nil
			}
			if m.Type == model.TypeChain {
				resolveErr = failedPrecondition("chain", "chain in chain is not allowed: %d", ids[i])
				return nil
			}
			resolved = append(resolved, m)
		}
		return resolved
	}

	ents := resolve(req.Profile)
	if resolveErr != nil {
		return nil, resolveErr
	}

	// Групповой front proxy добавляется в конец (становится входом).
	if req.Group != nil && req.Group.FrontProxyID != nil && *req.Group.FrontProxyID >= 0 {
		f, err := lookup(*req.Group.FrontProxyID)
		if err != nil || f == nil {
			return nil, failedPrecondition("chain", "front proxy ent not found")
		}
		ents = append(ents, resolve(f)...)
		if resolveErr != nil {
			return nil, resolveErr
		}
	}
	return ents, nil
}

// buildChainOutbounds — порт BuildChainInternal (ConfigBuilder.cpp:174–385),
// только внутренние sing-box-outbound'ы (внешние ядра — W6 за флагом).
//
// Теги: index 0 → "proxy"; последний → "g-<id>" (дедуплицируется);
// промежуточные → "c-<chainId>-<id>". detour каждого outbound'а указывает
// на предыдущий по направлению к клиенту.
func buildChainOutbounds(chainID int, ents []*model.Profile, st *BuildSettings, res *BuildResult) ([]map[string]any, error) {
	chainTag := "c-" + strconv.Itoa(chainID)
	var outbounds []map[string]any
	globalProfiles := map[int64]bool{}
	muxApplied := false

	for index, ent := range ents {
		tagOut := chainTag + "-" + strconv.FormatInt(ent.ID, 10)

		needGlobal := false
		isFirstProfile := index == len(ents)-1
		if isFirstProfile {
			needGlobal = true
			tagOut = "g-" + strconv.FormatInt(ent.ID, 10)
		}
		if chainID == 0 && index == 0 {
			needGlobal = false
			tagOut = "proxy"
		}

		// ignoreConnTag: все, кроме "proxy".
		if index != 0 {
			res.IgnoreConnTags = append(res.IgnoreConnTags, tagOut)
		}

		// Патч detour предыдущего outbound'а. NB (ревью N1): оракул
		// (ConfigBuilder.cpp:212→219) делает continue ДО патча detour; здесь
		// патч после — поведение ненаблюдаемо (дедупликация мёртвый код:
		// needGlobal истинен только на последнем индексе).
		if index > 0 && len(outbounds) > 0 {
			outbounds[len(outbounds)-1]["detour"] = tagOut
		}

		if needGlobal {
			if globalProfiles[ent.ID] {
				continue
			}
			globalProfiles[ent.ID] = true
		}

		if index == 0 {
			res.OutboundTag = tagOut
		}

		// Валидация адреса/порта (LNB-15: порт 0 невалиден; FR-UI-083 —
		// пробелы вырезаются на уровне модели). Для custom internal адрес
		// живёт в JSON outbound'а — валидируем только порт-заглушку.
		if err := validateEnt(ent); err != nil {
			return nil, err
		}

		outbound, err := buildOutbound(ent, st)
		if err != nil {
			return nil, err
		}
		outbound["tag"] = tagOut
		res.OutboundTags = append(res.OutboundTags, tagOut)

		// mux (§3.1.10): только vmess/trojan/vless; grpc/quic/tls-http
		// выключают; явное stream-решение перекрывает; flow выключает;
		// применяется не более одного раза на цепочку.
		needMux := needMuxFor(ent, outbound, st)
		if !muxApplied && needMux {
			outbound["multiplex"] = map[string]any{
				"enabled":     true,
				"protocol":    st.Mux.Protocol,
				"padding":     st.Mux.Padding,
				"max_streams": st.Mux.Concurrency,
			}
			muxApplied = true
		}

		// custom_outbound профиля — мерж в собственный outbound (точка
		// расширения FR-UI-084; для импортированных — после подтверждения,
		// LNB-25/FR-UI-257).
		if ent.CustomOutboundJSON != "" && ent.CustomFieldsConfirmed {
			var custom map[string]any
			if err := json.Unmarshal([]byte(ent.CustomOutboundJSON), &custom); err != nil {
				return nil, invalidArgument("custom_outbound", "profile %d: invalid JSON: %v", ent.ID, err)
			}
			MergeJSON(outbound, custom)
		}

		// Домены серверов цепочки → dns-direct full: (§3.1.4, потребляет W5).
		serverAddress := ent.Address
		if ent.Type == model.TypeCustomOutbound {
			if d, ok := ent.Detail.(*model.CustomDetail); ok {
				var o map[string]any
				if json.Unmarshal([]byte(d.OutboundJSON), &o) == nil {
					if s, ok := o["server"].(string); ok && s != "" {
						serverAddress = s
					}
				}
			}
		}
		if serverAddress != "" && !isIPAddr(serverAddress) {
			full := "full:" + serverAddress
			if !containsStr(res.ServerDomains, full) {
				res.ServerDomains = append(res.ServerDomains, full)
			}
		}

		outbounds = append(outbounds, outbound)
	}
	return outbounds, nil
}

func validateEnt(p *model.Profile) error {
	// Адрес/порт custom internal живёт в JSON outbound'а — поля профиля
	// валидации не подлежат.
	if p.Type == model.TypeCustomOutbound {
		return nil
	}
	if strings.TrimSpace(p.Address) == "" {
		return invalidArgument("address", "profile %d: server address is empty", p.ID)
	}
	if p.Port <= 0 || p.Port > 65535 {
		return invalidArgument("port", "profile %d: invalid port %d", p.ID, p.Port)
	}
	return nil
}

// needMuxFor — порт mux-логики оракула (ConfigBuilder.cpp:327–345).
func needMuxFor(ent *model.Profile, outbound map[string]any, st *BuildSettings) bool {
	needMux := false
	switch ent.Type {
	case model.TypeVMess, model.TypeTrojan, model.TypeVLESS:
		needMux = st.Mux.Concurrency > 0
	}
	s := ent.Stream
	if s != nil {
		if s.Network == "grpc" || s.Network == "quic" || (s.Network == "http" && s.Security == "tls") {
			needMux = false
		}
		switch s.Multiplex {
		case 0:
			if !st.Mux.DefaultOn {
				needMux = false
			}
		case 1:
			// Явное per-profile «вкл» не может включить mux при глобально
			// выключенном (Concurrency <= 0): нет валидной concurrency —
			// применить нечего (см. TestMuxRules, concurrency=-1).
			needMux = st.Mux.Concurrency > 0
		case 2:
			needMux = false
		}
	}
	if ent.Type == model.TypeVLESS {
		if flow, ok := outbound["flow"].(string); ok && flow != "" {
			needMux = false
		}
	}
	return needMux
}

func containsStr(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// MarshalIndent — детерминированный (ключи отсортированы) JSON конфига.
func MarshalIndent(cfg map[string]any) ([]byte, error) {
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("cfgbuild: marshal config: %w", err)
	}
	return b, nil
}
