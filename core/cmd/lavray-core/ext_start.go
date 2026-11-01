// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"fmt"
	"os"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/api"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/logs"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
)

// checkExtFlags завершает процесс с кодом 2 при недопустимом сочетании флагов.
func (f *extFlags) checkExtFlags() {
	if msg := f.validate(); msg != "" {
		fmt.Fprintln(os.Stderr, "lavray-core:", msg)
		os.Exit(2)
	}
}

// enableExt включает веб-режим и шлюз на server; вызывать до server.Register.
// Возвращает веб-слушатель (nil без --web-bind). Ошибка занимает ядро: молча
// запуститься без запрошенной панели или шлюза нельзя.
func (f *extFlags) enableExt(server *api.Server, st *store.Store, dataDir string, mux *logs.Mux) *webRuntime {
	var rt *webRuntime
	err := f.enableGateway(server, st)
	if err == nil && f.webBind != "" {
		rt, err = f.enableWeb(server, st, dataDir)
	}
	if err != nil {
		mux.Logf(logs.LevelError, "core", "запуск: %v", err)
		fmt.Fprintln(os.Stderr, "lavray-core:", err)
		os.Exit(1)
	}
	return rt
}
