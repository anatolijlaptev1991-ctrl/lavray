// SPDX-License-Identifier: GPL-3.0-only

// shutdown.go — выход процесса ядра (T-52): запрос выхода по RPC Shutdown и
// штатная остановка sing-box перед выходом по любой причине.
package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/logs"
)

// exitRequest — запрос выхода от RPC CoreService.Shutdown. api.Server.Shutdown
// останавливает инстанс и зовёт OnShutdown, но из процесса не выходит; раньше
// OnShutdown не назначался, и RPC оставлял ядро жить.
type exitRequest struct {
	once sync.Once
	ch   chan struct{}
}

func newExitRequest() *exitRequest { return &exitRequest{ch: make(chan struct{})} }

// trigger — значение для api.Server.OnShutdown; не блокирует, чтобы RPC успел
// вернуть ответ, пока main дожидается активных запросов.
func (e *exitRequest) trigger(context.Context) { e.once.Do(func() { close(e.ch) }) }

func (e *exitRequest) done() <-chan struct{} { return e.ch }

type instanceStopper interface {
	StopInstance(ctx context.Context) error
}

// gracefulExit — выход процесса: сначала останавливается sing-box (TUN,
// маршруты, inbounds; AUDIT §7.1.2 — Close до выхода), затем HTTP-сервер:
// активным запросам даётся drain, остальное (стримы статистики и журнала сами
// не кончаются) закрывается принудительно. Раньше при EOF stdin и сигнале
// закрывался один HTTP-сервер, и ждал он до 10 с (A1-18, A2-12). Строка в
// errOut (stderr) попадает в кольцо логов оболочки (spec §4).
func gracefulExit(stopper instanceStopper, srv *http.Server, mux *logs.Mux, errOut io.Writer, drain time.Duration) {
	if err := stopper.StopInstance(context.Background()); err != nil {
		mux.Logf(logs.LevelError, "core", "остановка инстанса при выходе: %v", err)
		fmt.Fprintf(errOut, "lavray-core: остановка инстанса при выходе не удалась: %v\n", err)
	} else {
		mux.Logf(logs.LevelInfo, "core", "инстанс остановлен, выход")
		fmt.Fprintln(errOut, "lavray-core: инстанс остановлен, выход")
	}
	ctx, cancel := context.WithTimeout(context.Background(), drain)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		_ = srv.Close()
	}
}
