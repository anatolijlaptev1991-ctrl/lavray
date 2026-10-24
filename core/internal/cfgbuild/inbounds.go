// inbounds.go — генерация inbounds (порт BuildConfigSingBox,
// ConfigBuilder.cpp:393–450): mixed-слушатель по настройкам inbound.*
// (auth опционален; FR-UI-279: не-loopback адрес требует пары user/pass,
// в режиме TUN слушателей на loopback нет вовсе), TUN-инбаунд по tun.*
// (FR-UI-184: interface_name/address/mtu/stack/strict_route/auto_route;
// kill-switch FR-UI-275 форсирует strict_route), custom_inbound-добавка.
//
// Отклонения от оракула (см. deviations.yaml):
//   - FR-UI-279: при включённом TUN mixed-слушатель не эмитится (оракул
//     эмитил оба — уязвимость апреля 2026);
//   - endpoint_independent_nat не эмитится — поле удалено в sing-box 1.14
//     (Deprecated: removed, option/tun.go);
//   - interface_name по умолчанию lavray-tun (darwin: utun9), не neko-tun.
package cfgbuild

import (
	"encoding/json"
	"net"
	"runtime"
	"strings"
)

// defaultTunName — имя TUN-интерфейса по умолчанию (plan §3.1.3:
// lavray-tun — настраиваемое; macOS — utun9 как в оракуле).
func defaultTunName(goos string) string {
	if goos == "darwin" {
		return "utun9"
	}
	return "lavray-tun"
}

// buildInbounds — mixed-in + tun-in + custom_inbound (порядок оракула).
func buildInbounds(st *BuildSettings, forTest bool) ([]any, error) {
	var inbounds []any

	// mixed-in: выключен в forTest и в режиме TUN (FR-UI-279).
	if !forTest && !st.Tun.Enabled && st.Inbound.Port > 0 && st.Inbound.Port <= 65535 {
		listen := strings.TrimSpace(st.Inbound.Address)
		if listen == "" {
			listen = "127.0.0.1"
		}
		// FR-UI-279: слушатель не на loopback — только с аутентификацией.
		if !isLoopbackAddr(listen) && (st.Inbound.AuthUser == "" || st.Inbound.AuthPass == "") {
			return nil, invalidArgument("inbound.address",
				"non-loopback inbound address %q requires inbound.auth.user and inbound.auth.pass (FR-UI-279)", listen)
		}
		in := map[string]any{
			"tag":         "mixed-in",
			"type":        "mixed",
			"listen":      listen,
			"listen_port": st.Inbound.Port,
		}
		if st.Inbound.AuthUser != "" && st.Inbound.AuthPass != "" {
			in["users"] = []any{map[string]any{
				"username": st.Inbound.AuthUser,
				"password": st.Inbound.AuthPass,
			}}
		}
		inbounds = append(inbounds, in)
	}

	// tun-in (FR-UI-184; оракул ConfigBuilder.cpp:414–428).
	if st.Tun.Enabled && !forTest {
		name := strings.TrimSpace(st.Tun.InterfaceName)
		if name == "" {
			name = defaultTunName(goosOf(st))
		}
		mtu := st.Tun.MTU
		if mtu <= 0 {
			mtu = 9000
		}
		address := []any{"172.19.0.1/28"}
		if st.Tun.IPv6 {
			address = append(address, "fdfe:dcba:9876::1/126")
		}
		in := map[string]any{
			"tag":            "tun-in",
			"type":           "tun",
			"interface_name": name,
			"auto_route":     true,
			"mtu":            mtu,
			"address":        address,
		}
		if stack := strings.TrimSpace(st.Tun.Stack); stack != "" {
			in["stack"] = stack
		}
		// Kill-switch (FR-UI-275, §10.6 плана): в конфигбилдере — форс
		// strict_route (трафик не может обойти упавший TUN); полная
		// блокировка при падении туннеля — координация с помощником/фаерволом
		// (shell-lifecycle §7, W8). Исключение приватных сетей сохраняется
		// (geoip:private в direct-списках пресетов).
		in["strict_route"] = st.Tun.StrictRoute || st.Tun.KillSwitch
		inbounds = append(inbounds, in)
	}

	// custom_inbound: {"inbounds":[...]} добавляется к сгенерированным.
	if !forTest {
		raw := strings.TrimSpace(st.Inbound.CustomInboundJSON)
		if raw != "" && raw != "{}" {
			var custom struct {
				Inbounds []any `json:"inbounds"`
			}
			if err := json.Unmarshal([]byte(raw), &custom); err != nil {
				return nil, invalidArgument("inbound.custom_inbound", "invalid JSON: %v", err)
			}
			inbounds = append(inbounds, custom.Inbounds...)
		}
	}
	return inbounds, nil
}

// isLoopbackAddr — IP-литерал loopback (127.0.0.0/8, ::1). Имя хоста
// считается loopback только для "localhost".
func isLoopbackAddr(s string) bool {
	if strings.EqualFold(s, "localhost") {
		return true
	}
	ip := net.ParseIP(strings.TrimSpace(s))
	return ip != nil && ip.IsLoopback()
}

// goosOf — платформа сборки/выполнения для tun-name и процессных правил.
func goosOf(st *BuildSettings) string {
	if st.GOOS != "" {
		return st.GOOS
	}
	return runtime.GOOS
}
