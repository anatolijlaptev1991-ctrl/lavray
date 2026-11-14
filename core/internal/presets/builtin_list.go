// SPDX-License-Identifier: GPL-3.0-only

package presets

// builtin_list.go — каталог встроенных наборов и их загрузка (вынесено из
// preset.go трещоткой размеров: добавление набора не должно расти в файле
// валидации). Синхронизировано с presets/ репозитория тестом
// TestBuiltinInSyncWithRepo и с lavray-core-rs crates/lavray-presets/builtin.rs.

import "fmt"

// BuiltinFiles — имена 6 builtin-наборов (PRESET-LAV-RU §3a; «Выборочный» —
// пустой пользовательский набор, не файл). lav-openwrt — персональный пресет
// роутера: lav-ru без процессных правил (на роутере process_name
// неприменим — трафик от LAN-устройств; SCHEMA §2.1).
var BuiltinFiles = []string{
	"lav-ru.json", "lav-cn.json", "lav-openwrt.json", "global.json",
	"all-proxy.json", "all-direct.json",
}

// BuiltinPresets загружает все встроенные пресеты (синхронизированы с
// presets/ репозитория тестом TestBuiltinInSyncWithRepo).
func BuiltinPresets() ([]*Preset, error) {
	out := make([]*Preset, 0, len(BuiltinFiles))
	for _, name := range BuiltinFiles {
		data, err := builtinFS.ReadFile("builtin/" + name)
		if err != nil {
			return nil, fmt.Errorf("builtin: %w", err)
		}
		p, err := LoadPreset(data)
		if err != nil {
			return nil, fmt.Errorf("builtin %s: %w", name, err)
		}
		if !p.Builtin {
			return nil, fmt.Errorf("builtin %s: builtin=false", name)
		}
		out = append(out, p)
	}
	return out, nil
}
