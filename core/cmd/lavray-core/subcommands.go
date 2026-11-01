// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"fmt"
	"io"
)

// subcommands.go — подкоманды, которые не запускают ядро: `mcp` (MCP-сервер по
// stdio) `import-nekobox` (перенос данных из NekoBox) и
// `verify-artifact` (проверка установщика по подписи, T-75). main.go только
// вызывает runSubcommand — его размер в size-ratchet не растёт.

// runSubcommand выполняет подкоманду, если args её называет. handled == false —
// это не подкоманда (разбирает main: `serve`).
func runSubcommand(args []string, in io.Reader, out, errOut io.Writer) (code int, handled bool) {
	if len(args) < 2 {
		return 0, false
	}
	switch args[1] {
	case "mcp":
		return runMCP(args[2:], in, out, errOut), true
	case "import-nekobox":
		return runImportNekoBox(args[2:], out, errOut), true
	case "verify-artifact":
		return runVerifyArtifact(args[2:], out, errOut), true
	}
	return 0, false
}

// printUsage — справка по запуску.
func printUsage(w io.Writer) {
	fmt.Fprintln(w, "использование: lavray-core serve --listen-socket <path> [--data dir] [--headless]")
	fmt.Fprintln(w, "               lavray-core mcp [--data dir]   (MCP-сервер по stdio для ИИ-агентов)")
	fmt.Fprintln(w, "               lavray-core import-nekobox --data dir --from <config NekoBox> [--dry-run] [--no-routes] [--no-settings]")
	fmt.Fprintln(w, "               lavray-core verify-artifact --file F --sig F.minisig [--data dir] [--allow-older]")
}
