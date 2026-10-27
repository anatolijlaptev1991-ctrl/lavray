// Package gateway — шлюз OpenWrt (W8, OPENWRT-GATEWAY §3–5): nftables-
// include для fw4 (tproxy), политики per-MAC, watchdog связи. Всё платформо-
// зависимое — за интерфейсами: рендер nft-конфига детерминирован (golden),
// применение/снятие — за Runner-интерфейсом (реальный fw4 — OpenWrt-сборка;
// тесты — фейковый раннер); watchdog — тикер + статус-интерфейс.
package gateway

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

// Config — конфигурация шлюза (UCI /etc/config/lavray).
type Config struct {
	TProxyPort  int  // порт ядра для tproxy (mixed/tproxy-инбаунд)
	Enabled     bool // глобально
	IPv6        bool // отдельная ip6-цепочка, ВЫКЛ по умолчанию (§5)
	DNSHijack   bool // порт 53 → ядро
	WatchdogMin int  // N минут без связи → снять правила (0 = 5)
}

// DevicePolicy — маршрутизация устройства LAN по MAC (GatewayService).
type DevicePolicy struct {
	MAC    string
	Policy string // "proxy" | "direct" | "preset"
}

// NftRenderer — рендер include-файла fw4 (детерминированный, golden).
type NftRenderer struct{}

// Render — полный nft-скрипт таблицы inet lavray (§3): tproxy PREROUTING,
// исключения приватных/роутера/DHCP, OUTPUT-исключения, DNS-hijack, per-MAC.
// skuid-исключение трафика самого lavrayd: uid задаётся сборкой (обычно
// «lavray»); тут — параметр.
func (NftRenderer) Render(cfg Config, policies []DevicePolicy, selfUser string) string {
	var b strings.Builder
	b.WriteString("#!/usr/sbin/nft -f\n")
	b.WriteString("# LAVRay gateway include (fw4): /usr/share/nftables.d/chain-post/lavray.nft\n")
	b.WriteString("# Сгенерировано lavrayd; правь политики в UCI, не здесь.\n")
	b.WriteString("table inet lavray\n")
	b.WriteString("delete table inet lavray\n\n")

	b.WriteString("table inet lavray {\n")

	// Сет исключений (адресные, вне цепочек для читаемости fw4).
	b.WriteString("\tset exclude_addr {\n\t\ttype ipv4_addr\n\t\telements = { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16, 224.0.0.0/4 }\n\t}\n")
	b.WriteString("\tset exclude_addr6 {\n\t\ttype ipv6_addr\n\t\telements = { fc00::/7, fe80::/10, ::1 }\n\t}\n")

	// PREROUTING tproxy.
	b.WriteString("\tchain prerouting {\n")
	b.WriteString("\t\ttype filter hook prerouting priority mangle; policy accept;\n")
	fmt.Fprintf(&b, "\t\tmeta skuid \"%s\" return\n", selfUser)
	b.WriteString("\t\tip daddr @exclude_addr return\n")
	if cfg.IPv6 {
		b.WriteString("\t\tip6 daddr @exclude_addr6 return\n")
	}
	b.WriteString("\t\tudp dport 67 return\n\t\tudp dport 68 return\n")
	if cfg.DNSHijack {
		fmt.Fprintf(&b, "\t\tudp dport 53 tproxy to :%d accept\n", cfg.TProxyPort)
	}
	fmt.Fprintf(&b, "\t\tmeta l4proto { tcp, udp } tproxy to :%d accept\n", cfg.TProxyPort)
	b.WriteString("\t}\n")

	// OUTPUT: локальный трафик роутера не заворачиваем (шлюз — только LAN).
	b.WriteString("\tchain output {\n")
	b.WriteString("\t\ttype route hook output priority mangle; policy accept;\n")
	b.WriteString("\t}\n")

	// Per-MAC политики (§4): отсортированы по MAC (детерминизм).
	if len(policies) > 0 {
		b.WriteString("\tchain device_policy {\n")
		sorted := append([]DevicePolicy(nil), policies...)
		sort.Slice(sorted, func(i, j int) bool { return strings.ToLower(sorted[i].MAC) < strings.ToLower(sorted[j].MAC) })
		for _, p := range sorted {
			mac := strings.ToLower(strings.TrimSpace(p.MAC))
			// W-11: MAC валидируется строго — «aa:..\nadd rule …» иначе
			// дописывает произвольные правила в nft (root на роутере).
			if !validMAC(mac) {
				continue
			}
			switch p.Policy {
			case "direct":
				fmt.Fprintf(&b, "\t\tether saddr %s return\n", mac)
			case "preset":
				fmt.Fprintf(&b, "\t\tether saddr %s jump preset_%s\n", mac, sanitizeChain(mac))
			default: // proxy — явный tproxy (перестраховка от будущих default)
				fmt.Fprintf(&b, "\t\tether saddr %s tproxy to :%d accept\n", mac, cfg.TProxyPort)
			}
		}
		b.WriteString("\t}\n")
	}
	b.WriteString("}\n")
	return b.String()
}

// validMAC — строгий формат xx:xx:xx:xx:xx:xx.
func validMAC(mac string) bool {
	if len(mac) != 17 {
		return false
	}
	for i, r := range mac {
		if (i+1)%3 == 0 {
			if r != ':' {
				return false
			}
			continue
		}
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			return false
		}
	}
	return true
}

// safeUser — только [a-z0-9_-] (uid/имя пользователя lavrayd).
func safeUser(u string) string {
	var b strings.Builder
	for _, r := range u {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '_' || r == '-' {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "lavray"
	}
	return b.String()
}

func sanitizeChain(mac string) string {
	r := strings.NewReplacer(":", "_", "-", "_")
	return r.Replace(mac)
}

// Applier — применение/снятие include (реальный: fw4 reload/файл; тесты — мок).
type Applier interface {
	Apply(nftScript string) error
	Remove() error
}

// Watchdog — «нет связи N минут или ядро упало → снять правила → интернет
// напрямую; восстановилось → вернуть» (§5). Тесты — ручная прокрутка времени.
type Watchdog struct {
	Threshold time.Duration
	Applier   Applier
	Renderer  NftRenderer
	Config    Config
	Policies  func() []DevicePolicy

	mu         sync.Mutex
	lastBeat   time.Time
	armed      bool
	rulesUp    bool
	OnFailover func(active bool) // уведомление (событие/лог)
}

// Beat — связь есть (пинг через туннель/статус инстанса).
func (w *Watchdog) Beat(now time.Time) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.lastBeat = now
	w.armed = true
	if !w.rulesUp { // правила сняты failover-ом — восстановление
		// L41 (аудит round 2): rulesUp выставляется по РЕЗУЛЬТАТУ Apply.
		// Раньше флаг поднимался до вызова, и при ошибке fw4 правила
		// считались установленными — ретрая не было вовсе.
		if err := w.Applier.Apply(w.Renderer.Render(w.Config, w.Policies(), "lavray")); err == nil {
			w.rulesUp = true
			if w.OnFailover != nil {
				w.OnFailover(false)
			}
		}
	}
}

// Tick — проверка (вызывается раз в минуту).
func (w *Watchdog) Tick(now time.Time) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.armed || !w.rulesUp {
		return // не вооружён / уже снято (ждём Beat для возврата)
	}
	if now.Sub(w.lastBeat) >= w.Threshold {
		if err := w.Applier.Remove(); err == nil {
			w.rulesUp = false
			if w.OnFailover != nil {
				w.OnFailover(true) // интернет напрямую, уведомление
			}
		}
	}
}

// StartArmed — правила применены, watchdog активен (вызов после старта шлюза).
func (w *Watchdog) StartArmed(now time.Time) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.lastBeat = now
	w.armed = true
	w.rulesUp = true
	return w.Applier.Apply(w.Renderer.Render(w.Config, w.Policies(), "lavray"))
}
