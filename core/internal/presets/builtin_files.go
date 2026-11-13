// SPDX-License-Identifier: GPL-3.0-only

package presets

// BuiltinFiles — имена 6 builtin-наборов (PRESET-LAV-RU §3a; «Выборочный» —
// пустой пользовательский набор, не файл). lav-openwrt — персональный пресет
// роутера: lav-ru без процессных правил (на роутере process_name
// неприменим — трафик от LAN-устройств; SCHEMA §2.1).
var BuiltinFiles = []string{
	"lav-ru.json", "lav-cn.json", "lav-openwrt.json", "global.json",
	"all-proxy.json", "all-direct.json",
}
