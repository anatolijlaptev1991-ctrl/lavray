package presets

import "embed"

// builtinFS — копии presets/*.json из корня репозитория (go:embed не достаёт
// за пределы модуля). Синхронизация с ../../../.. /presets — тестом
// TestBuiltinInSyncWithRepo.
//
//go:embed builtin
var builtinFS embed.FS
