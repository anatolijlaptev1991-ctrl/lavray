// gateway_test.go — nft-рендер (golden-инварианты), watchdog-переходы,
// per-MAC-политики. Платформо-независимо: Applier-мок.
package gateway

import (
	"errors"
	"strings"
	"testing"
	"time"
)

type memApplier struct {
	applied  []string
	removed  int
	failNext bool
}

func (m *memApplier) Apply(s string) error {
	if m.failNext {
		m.failNext = false
		return errors.New("boom")
	}
	m.applied = append(m.applied, s)
	return nil
}
func (m *memApplier) Remove() error {
	if m.failNext {
		m.failNext = false
		return errors.New("boom")
	}
	m.removed++
	return nil
}

func cfg() Config { return Config{TProxyPort: 7893, Enabled: true, DNSHijack: true} }

func TestRenderGoldenInvariants(t *testing.T) {
	r := NftRenderer{}
	out := r.Render(cfg(), []DevicePolicy{
		{MAC: "AA:BB:CC:11:22:33", Policy: "direct"},
		{MAC: "aa:bb:cc:44:55:66", Policy: "proxy"},
	}, "lavray")

	checks := []struct{ what, sub string }{
		{"таблица", "table inet lavray {"},
		{"tproxy tcp+udp", "meta l4proto { tcp, udp } tproxy to :7893 accept"},
		{"skuid-исключение", `meta skuid "lavray" return`},
		{"приватные исключены", "192.168.0.0/16"},
		{"DHCP не заворачиваем", "udp dport 67 return"},
		{"DNS hijack", "udp dport 53 tproxy to :7893 accept"},
		{"MAC direct", "ether saddr aa:bb:cc:11:22:33 return"},
		{"MAC proxy", "ether saddr aa:bb:cc:44:55:66 tproxy to :7893 accept"},
		{"idempotent header", "delete table inet lavray"},
	}
	for _, c := range checks {
		if !strings.Contains(out, c.sub) {
			t.Errorf("%s: нет %q", c.what, c.sub)
		}
	}
	// Детерминизм: те же входы — тот же вывод.
	if out2 := r.Render(cfg(), []DevicePolicy{
		{MAC: "AA:BB:CC:11:22:33", Policy: "direct"},
		{MAC: "aa:bb:cc:44:55:66", Policy: "proxy"},
	}, "lavray"); out != out2 {
		t.Fatal("рендер недетерминирован")
	}
	// MAC отсортированы (AA..33 перед aa..66 независимо от порядка входа).
	i1 := strings.Index(out, "aa:bb:cc:11")
	i2 := strings.Index(out, "aa:bb:cc:44")
	if i1 < 0 || i2 < 0 || i1 > i2 {
		t.Fatal("MAC-правила не отсортированы")
	}
}

func TestRenderIPv6OffByDefault(t *testing.T) {
	out := NftRenderer{}.Render(Config{TProxyPort: 1}, nil, "x")
	if strings.Contains(out, "ip6 daddr") {
		t.Fatal("IPv6 включён по умолчанию — должен быть ВЫКЛ (§5)")
	}
	out6 := NftRenderer{}.Render(Config{TProxyPort: 1, IPv6: true}, nil, "x")
	if !strings.Contains(out6, "ip6 daddr @exclude_addr6") {
		t.Fatal("IPv6-цепочка не сгенерирована при IPv6=true")
	}
}

func TestWatchdogFailoverAndRecovery(t *testing.T) {
	ap := &memApplier{}
	w := &Watchdog{
		Threshold: 5 * time.Minute,
		Applier:   ap,
		Config:    cfg(),
		Policies:  func() []DevicePolicy { return nil },
	}
	t0 := time.Now()
	if err := w.StartArmed(t0); err != nil {
		t.Fatal(err)
	}
	if len(ap.applied) != 1 {
		t.Fatal("правила не применены при старте")
	}

	// Тики без Beat: 4 минуты — ещё держим, 5+ — сняли.
	for i := 1; i <= 4; i++ {
		w.Tick(t0.Add(time.Duration(i) * time.Minute))
	}
	if ap.removed != 0 {
		t.Fatalf("снял раньше порога: %d", ap.removed)
	}
	failoverNotified := false
	w.OnFailover = func(active bool) {
		if active {
			failoverNotified = true
		}
	}
	w.Tick(t0.Add(5 * time.Minute))
	if ap.removed != 1 || !failoverNotified {
		t.Fatalf("порог не сработал: removed=%d notified=%v", ap.removed, failoverNotified)
	}

	// Восстановление: Beat возвращает правила.
	recovered := false
	w.OnFailover = func(active bool) {
		if !active {
			recovered = true
		}
	}
	w.Beat(t0.Add(6 * time.Minute))
	if len(ap.applied) != 2 || !recovered {
		t.Fatalf("восстановление: applied=%d recovered=%v", len(ap.applied), recovered)
	}

	// Ошибка применения при восстановлении не паникует.
	ap.failNext = true
	w.Tick(t0.Add(30 * time.Minute)) // снова порог → Remove ок
	ap.failNext = true
	w.Beat(t0.Add(31 * time.Minute)) // Apply упал → молча ждём следующего Beat
	if len(ap.applied) != 2 {        // не изменилось
		t.Fatalf("после сбоя Apply: applied=%d", len(ap.applied))
	}
}

func TestWatchdogBeatPreventsFailover(t *testing.T) {
	ap := &memApplier{}
	w := &Watchdog{Threshold: 5 * time.Minute, Applier: ap, Config: cfg(), Policies: func() []DevicePolicy { return nil }}
	t0 := time.Now()
	_ = w.StartArmed(t0)
	// Beat каждые 4 минуты — никогда не сработает.
	for i := 1; i <= 10; i++ {
		w.Beat(t0.Add(time.Duration(i*4) * time.Minute))
		w.Tick(t0.Add(time.Duration(i*4) * time.Minute).Add(time.Second))
	}
	if ap.removed != 0 {
		t.Fatal("watchdog снял правила при живой связи")
	}
}
