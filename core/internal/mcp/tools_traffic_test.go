// SPDX-License-Identifier: GPL-3.0-only

package mcp

import (
	"strings"
	"testing"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/traffic"
)

// get_traffic показывает скорость, посчитанную ядром из дельт по тегам (T-79):
// сумма по тегам, итоги сессии и объём по активному серверу. Источник —
// подставной, трафик наращивается фоном, как при живой работе.
func TestGetTrafficShowsSpeedFromTags(t *testing.T) {
	e := newEnv(t, "control")
	src := traffic.NewFakeSource()
	src.Open(traffic.ConnInfo{ID: "a", Outbound: "proxy", Destination: "secret-host.example.org:443"})
	src.Open(traffic.ConnInfo{ID: "b", Outbound: "direct", Destination: "other.example.org:80"})
	e.runner.SetTraffic(src)
	e.ok("connect", `{"server_id":`+e.profileID(e.nl)+`}`)

	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case <-stop:
				return
			case <-time.After(20 * time.Millisecond):
				src.AddBytes("a", 2000, 10000)
				src.AddBytes("b", 0, 3000)
			}
		}
	}()
	t.Cleanup(func() { close(stop); <-done })

	res := e.ok("get_traffic", `{}`)
	st := structured(t, res)
	speed, _ := st["speed"].(map[string]any)
	if speed == nil {
		t.Fatalf("скорость не показана при работающем источнике: %v / %q", st, res.Text)
	}
	down, _ := speed["download_bytes_per_second"].(float64)
	up, _ := speed["upload_bytes_per_second"].(float64)
	if down <= 0 || up <= 0 || down <= up {
		t.Fatalf("скорость ↓%v ↑%v: ожидалась сумма по тегам proxy и direct, вниз больше, чем вверх", down, up)
	}
	if sess, _ := st["session"].(map[string]any); sess == nil || sess["download_bytes"].(float64) <= 0 {
		t.Fatalf("итоги сессии: %v", st["session"])
	}
	if st["active_server_total"] == nil {
		t.Fatalf("нет объёма по серверу: %v", st)
	}
	if !strings.Contains(res.Text, "Скорость") || strings.Contains(res.Text, "недоступна") {
		t.Fatalf("текст: %q", res.Text)
	}
	// Агенту уходят только числа: ни адресов назначения, ни имён тегов с адресами.
	assertNoSecrets(t, "get_traffic", res)
	if strings.Contains(res.Text, "example.org") {
		t.Fatalf("в ответе адрес назначения: %q", res.Text)
	}
}
