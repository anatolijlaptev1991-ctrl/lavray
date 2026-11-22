// SPDX-License-Identifier: GPL-3.0-only

package presets

// lavru_rev5_test.go — содержимое ревизии 5 встроенного lav-ru
// (docs/PRESET-LAV-RU.md §3f, §3g): World of Warcraft: Forever и Battle.net
// идут напрямую, bogolubov.center — напрямую.

import "testing"

func mustLavRU(t *testing.T) *Preset {
	t.Helper()
	all, err := BuiltinPresets()
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range all {
		if p.ID == "lav-ru" {
			return p
		}
	}
	t.Fatal("lav-ru не найден")
	return nil
}

func hasString(list []string, want string) bool {
	for _, x := range list {
		if x == want {
			return true
		}
	}
	return false
}

// Игровые процессы — в существующем правиле «напрямую», только для Windows.
func TestLavRURev5GameProcessesGoDirect(t *testing.T) {
	p := mustLavRU(t)
	for _, name := range []string{
		"Wow.exe", "WowVoiceProxy.exe", "World of Warcraft Launcher.exe",
		"BlizzardError.exe", "BlizzardBrowser.exe",
		"Battle.net.exe", "Battle.net Launcher.exe",
		"GameSessionMonitor.exe", "battlenet.overlay.runtime.exe",
	} {
		found := false
		for _, r := range p.Routing.ProcessRules {
			if len(r.Platforms) == 1 && r.Platforms[0] == "windows" &&
				r.Outbound == "direct" && hasString(r.ProcessNames, name) {
				found = true
			}
		}
		if !found {
			t.Errorf("%s: нет в процессном правиле direct для windows", name)
		}
	}
	if p.Revision < 5 {
		t.Errorf("revision = %d, игры Blizzard и bogolubov.center — ревизия 5", p.Revision)
	}
}

// Домены игр Blizzard и bogolubov.center — напрямую (их DNS идёт к
// провайдеру), и ни один из них не числится в прокси-списке.
func TestLavRURev5DomainsGoDirect(t *testing.T) {
	p := mustLavRU(t)
	for _, d := range []string{
		"domain:blizzard.com", "domain:battle.net", "domain:worldofwarcraft.com",
		"domain:blz-contentstack.com",
		"full:blzddist1-a.akamaihd.net", "full:bnetcmsus-a.akamaihd.net", "full:bnetproduct-a.akamaihd.net",
		// Суффиксное правило: покрывает и поддомены (www., lk.).
		"domain:bogolubov.center",
	} {
		if !hasString(p.Routing.DirectDomain, d) {
			t.Errorf("%s: нет в direct_domain", d)
		}
		if hasString(p.Routing.ProxyDomain, d) {
			t.Errorf("%s: есть и в proxy_domain", d)
		}
	}
}
