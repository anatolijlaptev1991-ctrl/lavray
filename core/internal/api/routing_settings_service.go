// routing_settings_service.go — RoutingService (builtin-пресеты + активный),
// DnsService и SettingsService (W6). Пользовательские пресеты,
// подписочные стримы и SubscribeSettings — W7 (unimplemented.go).
package api

import (
	"context"
	"encoding/json"

	"sort"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/inst"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/presets"
)

// instStateIdle — единственное состояние, когда настройки применяются
// без перезапуска (FR-UI-062).
const instStateIdle = inst.StateIdle

func (s *Server) builtinPresets() ([]*presets.Preset, error) {
	return presets.BuiltinPresets()
}

func (s *Server) ListPresets(ctx context.Context, req *connect.Request[lavrayv1.ListPresetsRequest]) (*connect.Response[lavrayv1.ListPresetsResponse], error) {
	list, err := s.builtinPresets()
	if err != nil {
		return nil, mapErr(err)
	}
	out := make([]*lavrayv1.RoutingPreset, 0, len(list))
	for _, p := range list {
		out = append(out, presetToProto(p))
	}
	active := s.activePresetID()
	if err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(&lavrayv1.ListPresetsResponse{Presets: out, ActivePresetId: active}), nil
}

func (s *Server) GetPreset(ctx context.Context, req *connect.Request[lavrayv1.GetPresetRequest]) (*connect.Response[lavrayv1.RoutingPreset], error) {
	p, ok, err := s.findPreset(req.Msg.Id)
	if err != nil {
		return nil, mapErr(err)
	}
	if !ok {
		return nil, notFound("пресет %q", req.Msg.Id)
	}
	return connect.NewResponse(presetToProto(p)), nil
}

func (s *Server) ActivatePreset(ctx context.Context, req *connect.Request[lavrayv1.ActivatePresetRequest]) (*connect.Response[lavrayv1.ActivatePresetResponse], error) {
	p, ok, err := s.findPreset(req.Msg.Id)
	if err != nil {
		return nil, mapErr(err)
	}
	if !ok {
		return nil, notFound("пресет %q", req.Msg.Id)
	}
	if err := p.Validate(); err != nil {
		return nil, mapErr(err)
	}
	// F2 (аудит №7): активный пресет — в settings (единственный источник,
	// который читает activePresetID при сборке конфига), не в meta.
	// Значение — JSON-строка (геттер settingStr делает json.Unmarshal).
	encoded, err := json.Marshal(p.ID)
	if err != nil {
		return nil, mapErr(err)
	}
	if err := s.st.SetSetting(settingActivePreset, string(encoded)); err != nil {
		return nil, mapErr(err)
	}
	needsRestart := s.inst.Status().State != instStateIdle
	return connect.NewResponse(&lavrayv1.ActivatePresetResponse{NeedsProfileRestart: needsRestart}), nil
}

func (s *Server) GetActivePreset(ctx context.Context, req *connect.Request[lavrayv1.GetActivePresetRequest]) (*connect.Response[lavrayv1.RoutingPreset], error) {
	active := s.activePresetID()
	p, ok, err := s.findPreset(active)
	if err != nil {
		return nil, mapErr(err)
	}
	if !ok {
		return nil, notFound("активный пресет %q", active)
	}
	return connect.NewResponse(presetToProto(p)), nil
}

// ---- DnsService --------------------------------------------------------------
// DNS-настройки живут в settings-хранилище с ключами dns.* (модель W1);
// SetDns применяет «живые» поля без перезапуска (FR-UI-148).

const (
	setDNSMode    = "dns.mode"
	setDNSRemote  = "dns.remote"
	setDNSDirect  = "dns.direct"
	setDNSRouting = "dns.routing_enabled"
	setDNSAdvJSON = "dns.advanced_json"
)

func (s *Server) GetDns(ctx context.Context, req *connect.Request[lavrayv1.GetDnsRequest]) (*connect.Response[lavrayv1.DnsSettings], error) {
	get := func(k string) string { v, _, _ := s.st.GetSetting(k); return v }
	out := &lavrayv1.DnsSettings{}
	switch get(setDNSMode) {
	case "advanced":
		out.Mode = lavrayv1.DnsSettings_MODE_ADVANCED
	default:
		out.Mode = lavrayv1.DnsSettings_MODE_SIMPLE
	}
	if v := get(setDNSRemote); v != "" {
		out.RemoteDns = strp(v)
	}
	if v := get(setDNSDirect); v != "" {
		out.DirectDns = strp(v)
	}
	if v, _, _ := s.st.GetSetting(setDNSRouting); v == "1" {
		out.RoutingEnabled = true
	}
	if v := get(setDNSAdvJSON); v != "" {
		out.AdvancedJson = strp(v)
	}
	return connect.NewResponse(out), nil
}

func (s *Server) SetDns(ctx context.Context, req *connect.Request[lavrayv1.SetDnsRequest]) (*connect.Response[lavrayv1.SetDnsResponse], error) {
	m := req.Msg.Dns
	if m == nil {
		return nil, invalidArg("dns обязателен")
	}
	if m.Mode == lavrayv1.DnsSettings_MODE_ADVANCED && optStr(m.AdvancedJson) != "" {
		if !json.Valid([]byte(*m.AdvancedJson)) {
			return nil, invalidArg("advanced_json: невалидный JSON")
		}
	}
	set := func(k, v string) error {
		if err := s.st.SetSetting(k, v); err != nil {
			return mapErr(err)
		}
		return nil
	}
	switch m.Mode {
	case lavrayv1.DnsSettings_MODE_ADVANCED:
		if err := set(setDNSMode, "advanced"); err != nil {
			return nil, err
		}
	default:
		if err := set(setDNSMode, "simple"); err != nil {
			return nil, err
		}
	}
	if m.RemoteDns != nil {
		if err := set(setDNSRemote, *m.RemoteDns); err != nil {
			return nil, err
		}
	}
	if m.DirectDns != nil {
		if err := set(setDNSDirect, *m.DirectDns); err != nil {
			return nil, err
		}
	}
	v := "0"
	if m.RoutingEnabled {
		v = "1"
	}
	if err := set(setDNSRouting, v); err != nil {
		return nil, err
	}
	if m.AdvancedJson != nil {
		if err := set(setDNSAdvJSON, *m.AdvancedJson); err != nil {
			return nil, err
		}
	}
	needsRestart := s.inst.Status().State != instStateIdle
	return connect.NewResponse(&lavrayv1.SetDnsResponse{NeedsProfileRestart: needsRestart}), nil
}

// ---- SettingsService ----------------------------------------------------------

func settingTypeToProto(t model.SettingType) lavrayv1.SettingType {
	switch t {
	case model.SettingString:
		return lavrayv1.SettingType_SETTING_TYPE_STRING
	case model.SettingBool:
		return lavrayv1.SettingType_SETTING_TYPE_BOOL
	case model.SettingInt:
		return lavrayv1.SettingType_SETTING_TYPE_INT
	case model.SettingStringList:
		return lavrayv1.SettingType_SETTING_TYPE_STRING_LIST
	case model.SettingJSON:
		return lavrayv1.SettingType_SETTING_TYPE_JSON
	default:
		return lavrayv1.SettingType_SETTING_TYPE_STRING
	}
}

func (s *Server) DescribeSettings(ctx context.Context, req *connect.Request[lavrayv1.DescribeSettingsRequest]) (*connect.Response[lavrayv1.DescribeSettingsResponse], error) {
	out := &lavrayv1.DescribeSettingsResponse{}
	for _, d := range model.SettingDescriptors() {
		out.Descriptors = append(out.Descriptors, &lavrayv1.SettingDescriptor{
			Key:  d.Key,
			Type: settingTypeToProto(d.Type),
		})
	}
	return connect.NewResponse(out), nil
}

func (s *Server) GetSettings(ctx context.Context, req *connect.Request[lavrayv1.GetSettingsRequest]) (*connect.Response[lavrayv1.GetSettingsResponse], error) {
	all, err := s.st.Settings()
	if err != nil {
		return nil, mapErr(err)
	}
	want := map[string]bool{}
	for _, k := range req.Msg.Keys {
		want[k] = true
	}
	out := &lavrayv1.GetSettingsResponse{Values: map[string]*lavrayv1.SettingValue{}}
	keys := make([]string, 0, len(all))
	for k := range all {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if len(want) > 0 && !want[k] {
			continue
		}
		out.Values[k] = &lavrayv1.SettingValue{Value: &lavrayv1.SettingValue_StringValue{StringValue: all[k]}}
	}
	return connect.NewResponse(out), nil
}

func (s *Server) SetSettings(ctx context.Context, req *connect.Request[lavrayv1.SetSettingsRequest]) (*connect.Response[lavrayv1.SetSettingsResponse], error) {
	known := map[string]bool{}
	for _, d := range model.SettingDescriptors() {
		known[d.Key] = true
	}
	resp := &lavrayv1.SetSettingsResponse{}
	keys := make([]string, 0, len(req.Msg.Values))
	for k := range req.Msg.Values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		v := req.Msg.Values[k]
		if !known[k] && !strings.HasPrefix(k, "dns.") {
			continue // неизвестный ключ не применяется и не попадает в accepted (LNB-30-класс: не молча — список accepted честный)
		}
		// F6 (аудит №7): значения хранятся СТРОГО как JSON — геттеры
		// (settingStr/Bool/Int) делают json.Unmarshal, поэтому "1"/"0" и
		// сырые строки молча превращались в дефолты (TUN/порты не применялись).
		var raw string
		switch kind := v.GetValue().(type) {
		case *lavrayv1.SettingValue_StringValue:
			b, err := json.Marshal(kind.StringValue)
			if err != nil {
				return nil, mapErr(err)
			}
			raw = string(b)
		case *lavrayv1.SettingValue_BoolValue:
			raw = strconv.FormatBool(kind.BoolValue)
		case *lavrayv1.SettingValue_IntValue:
			raw = strconv.FormatInt(kind.IntValue, 10)
		case *lavrayv1.SettingValue_DoubleValue:
			raw = strconv.FormatFloat(kind.DoubleValue, 'g', -1, 64)
		case *lavrayv1.SettingValue_JsonValue:
			raw = kind.JsonValue
		case *lavrayv1.SettingValue_StringListValue:
			b, err := json.Marshal(kind.StringListValue)
			if err != nil {
				return nil, mapErr(err)
			}
			raw = string(b)
		default:
			continue
		}
		if err := s.st.SetSetting(k, raw); err != nil {
			return nil, mapErr(err)
		}
		resp.AcceptedKeys = append(resp.AcceptedKeys, k)
	}
	return connect.NewResponse(resp), nil
}

// ---- SubscriptionService (минимум W6; Update-стримы — W7) ----------------------

func (s *Server) ListSubscriptions(ctx context.Context, req *connect.Request[lavrayv1.ListSubscriptionsRequest]) (*connect.Response[lavrayv1.ListSubscriptionsResponse], error) {
	groups, err := s.st.ListGroups()
	if err != nil {
		return nil, mapErr(err)
	}
	out := &lavrayv1.ListSubscriptionsResponse{}
	for _, g := range groups {
		if g.Kind == model.GroupSubscription {
			out.Groups = append(out.Groups, groupToProto(g))
		}
	}
	return connect.NewResponse(out), nil
}

func (s *Server) CreateSubscription(ctx context.Context, req *connect.Request[lavrayv1.CreateSubscriptionRequest]) (*connect.Response[lavrayv1.Group], error) {
	msg := req.Msg
	if strings.TrimSpace(msg.Url) == "" {
		return nil, invalidArg("url обязателен")
	}
	g := &model.Group{
		Name:            msg.Name,
		Kind:            model.GroupSubscription,
		SubscriptionURL: msg.Url,
	}
	if g.Name == "" {
		g.Name = hostOf(msg.Url)
	}
	if err := s.st.CreateGroup(g); err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(groupToProto(g)), nil
}

func hostOf(raw string) string {
	h := strings.TrimPrefix(strings.TrimPrefix(raw, "https://"), "http://")
	if i := strings.IndexByte(h, '/'); i > 0 {
		h = h[:i]
	}
	return h
}
