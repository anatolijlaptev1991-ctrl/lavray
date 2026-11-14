// SPDX-License-Identifier: GPL-3.0-only

package presets

// process_ratchet_test.go — «трещотка»: у встроенных наборов нет процессных
// правил, действующих на Linux.

import "testing"

// Любое процессное правило включает в sing-box поиск процесса для КАЖДОГО
// соединения с локальным источником (needFindProcess; перебор /proc/<pid>/fd).
// Замер 2026-11-14, Intel N100, 134 процесса пользователя, 300 новых
// соединений: медиана 0,86 → 12,98 мс, CPU ядра 1,1 → 14,0 мс на соединение,
// 945 → 75 соединений/с. Пустой platforms означает «все платформы», то есть
// и Linux. Windows-правила (platforms=["windows"]) допустимы.
func TestBuiltinsHaveNoLinuxProcessRules(t *testing.T) {
	all, err := BuiltinPresets()
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range all {
		rules, _ := EffectiveProcessRules(p, "linux", false)
		if len(rules) != 0 {
			t.Errorf("%s: %d процессных правил действуют на Linux (первое: %v). Каждое такое правило включает поиск процесса для каждого соединения (~13 мс CPU на N100, замер 2026-11-14); добавляйте их только в пользовательские копии, см. docs/PRESET-LAV-RU.md §3e",
				p.ID, len(rules), rules[0].ProcessNames)
		}
	}
}

// Windows-набор lav-ru остаётся: правила *.exe не должны потеряться.
func TestLavRUKeepsWindowsProcessRules(t *testing.T) {
	all, err := BuiltinPresets()
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range all {
		if p.ID != "lav-ru" {
			continue
		}
		win, _ := EffectiveProcessRules(p, "windows", false)
		if len(win) != 2 || win[0].Outbound != "proxy" || win[1].Outbound != "direct" {
			t.Fatalf("windows: %+v", win)
		}
		if p.Revision < 4 {
			t.Errorf("revision = %d, домены обновлений Linux — ревизия 4", p.Revision)
		}
		return
	}
	t.Fatal("lav-ru не найден")
}
