// SPDX-License-Identifier: GPL-3.0-only

package cfgbuild

// lavru_linux_test.go — конфиг lav-ru для Linux не содержит поиска процесса
// (docs/PRESET-LAV-RU.md §3e): регрессия на замер 2026-11-14 (Intel N100,
// 300 соединений: медиана 0,86 → 12,98 мс на соединение при любом процессном
// правиле). Эталон — golden G28b (Linux) рядом с G28 (Windows).

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/presets"
)

func mustLavRU(t *testing.T) *presets.Preset {
	t.Helper()
	all, err := presets.BuiltinPresets()
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

func TestLavRULinuxConfigHasNoProcessLookup(t *testing.T) {
	list := mustLavRU(t)
	for _, tun := range []bool{false, true} {
		st := DefaultSettings()
		st.GOOS = "linux"
		st.Tun.Enabled = tun
		res, err := Build(BuildRequest{Profile: socksProfile(1, "1.1.1.1", 1080), Settings: st, Preset: list})
		if err != nil {
			t.Fatal(err)
		}
		raw, err := json.Marshal(res.Config)
		if err != nil {
			t.Fatal(err)
		}
		for _, key := range []string{`"process_name"`, `"process_path`, `"find_process"`} {
			if strings.Contains(string(raw), key) {
				t.Errorf("tun=%v: в конфиге lav-ru для Linux есть %s — каждое такое правило включает поиск процесса для каждого соединения", tun, key)
			}
		}
	}
	// Windows сохраняет процессные правила.
	st := DefaultSettings()
	st.GOOS = "windows"
	res, err := Build(BuildRequest{Profile: socksProfile(1, "1.1.1.1", 1080), Settings: st, Preset: list})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(res.Config)
	if !strings.Contains(string(raw), `"process_name"`) {
		t.Error("windows: процессные правила пропали")
	}
}
