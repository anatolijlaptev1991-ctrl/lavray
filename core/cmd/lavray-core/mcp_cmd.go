// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"context"
	"flag"
	"io"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/mcp"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/version"
)

// runMCP — подкоманда `lavray-core mcp`: MCP-сервер по stdio для ИИ-агентов.
// Ядро не запускается: сервер подключается к работающему приложению по файлу
// agent-endpoint.json (адрес ядра, агентский токен, режим доступа). В stdout
// уходит только протокол, журнал — в stderr. Код возврата — для os.Exit.
func runMCP(args []string, in io.Reader, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("mcp", flag.ContinueOnError)
	fs.SetOutput(errOut)
	dataDir := fs.String("data", defaultDataDir(), "каталог данных LAVRay (в нём лежит agent-endpoint.json)")
	endpointFile := fs.String("endpoint-file", "", "путь к agent-endpoint.json вместо каталога данных (только для тестов)")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 {
		return 2
	}
	path := *endpointFile
	if path == "" {
		path = filepath.Join(*dataDir, mcp.EndpointFileName)
	}

	logger := log.New(errOut, "lavray-mcp: ", log.LstdFlags)
	srv := mcp.NewServer(mcp.NewTools(path), mcp.Options{Version: version.Version, Log: logger})
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := srv.Serve(ctx, in, out); err != nil {
		logger.Printf("остановлен с ошибкой: %v", err)
		return 1
	}
	return 0
}
