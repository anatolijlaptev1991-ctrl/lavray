// SPDX-License-Identifier: GPL-3.0-only

package presets

import (
	"encoding/json"
	"testing"
)

// FuzzConvertNekoRayRoute — инвариант (core-port-plan §4.3): конвертер не
// паникует на любом RoutingBean; успешный результат проходит валидацию схемы.
func FuzzConvertNekoRayRoute(f *testing.F) {
	f.Add(`{"custom":"{\"rules\":[]}","def_outbound":"proxy","sniffing_mode":1}`)
	f.Add(`{"custom":"not-json"}`)
	f.Add(`{"custom":"{\"rules\":[{\"process_name\":\"a.exe\",\"outbound\":\"bypass\"}]}"}`)
	f.Add(`{"proxy_domain":"geosite:google\ndomain:x","direct_ip":"geoip:ru","sniffing_mode":2}`)
	f.Add(`{}`)
	f.Add(`{"def_outbound":"weird","outbound_domain_strategy":"PreferIPv4","dns_routing":true,"use_dns_object":true,"dns_object":"{\"servers\":[]}"}`)
	f.Fuzz(func(t *testing.T, raw string) {
		var src NekoRayRoute
		if err := json.Unmarshal([]byte(raw), &src); err != nil {
			return // не RoutingBean — не наш вход
		}
		meta := PresetMeta{Schema: "preset.schema.v1.json", Version: 1, Revision: 1,
			ID: "fuzz", Name: Localized{"en": "F"}}
		p, _, err := ConvertNekoRayRoute(&src, ConvertOptions{Meta: meta, AddAdsBlocklist: true})
		if err != nil {
			return // структурная ошибка — норма
		}
		if err := p.Validate(); err != nil {
			t.Fatalf("успешная конвертация даёт невалидную схему: %v (source: %s)", err, raw)
		}
	})
}
