// SPDX-License-Identifier: GPL-3.0-only

package main

import "os"

// runSubcommand выполняет подкоманды, которые не запускают ядро: `mcp`
// (MCP-сервер по stdio) и `verify-artifact` (проверка установщика по подписи).
// ok=false — это не подкоманда, значит обычный запуск (`serve`).
func runSubcommand(args []string) (code int, ok bool) {
	if len(args) == 0 {
		return 0, false
	}
	switch args[0] {
	case "mcp":
		return runMCP(args[1:], os.Stdin, os.Stdout, os.Stderr), true
	case "verify-artifact":
		return runVerifyArtifact(args[1:], os.Stdout, os.Stderr), true
	}
	return 0, false
}
