// SPDX-License-Identifier: GPL-3.0-only

package main

// connect_last_cmd.go — флаги автоподключения `serve`: сервисный --headless
// (вечный цикл с авторестартом) и десктопный --connect-last (одна серия
// попыток при старте). Вместе они не работают: два подключателя гонялись бы
// за одним ядром.

import (
	"context"
	"errors"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/api"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/headless"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/logs"
)

// checkConnectFlags — несовместимые сочетания флагов автоподключения.
func checkConnectFlags(headlessMode, connectLast bool) error {
	if headlessMode && connectLast {
		return errors.New("--connect-last несовместим с --headless: служебный режим уже подключает сам")
	}
	return nil
}

// runHeadless — сервисный режим (F19): автозапуск запомненного профиля и
// авторестарт после падения через internal/headless.
func runHeadless(ctx context.Context, server *api.Server, mux *logs.Mux) {
	err := headless.Loop(ctx, server, headless.Options{})
	if err != nil && !errors.Is(err, api.ErrNoRememberedProfile) {
		mux.Logf("warn", "core", "headless-цикл завершён: %v", err)
	}
	<-ctx.Done()
}

// runConnectLast — однократное автоподключение десктопа (см. api.ConnectLastOnce).
func runConnectLast(ctx context.Context, server *api.Server, mux *logs.Mux) {
	if err := server.ConnectLastOnce(ctx); err != nil {
		mux.Logf(logs.LevelWarn, logs.SourceCore, "connect-last: %v", err)
	}
}
