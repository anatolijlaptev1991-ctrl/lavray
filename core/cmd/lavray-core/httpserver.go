// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"net/http"
	"time"
)

// Лимиты HTTP-сервера ядра (T-50, A1-14). Токен нужен, но любой локальный
// процесс может держать сколько угодно «висящих» соединений и гигантские
// заголовки. ReadTimeout и WriteTimeout НЕ задаются намеренно: серверные
// стримы (журнал, события, обновление подписок) живут минуты и часы.
const (
	httpReadHeaderTimeout = 10 * time.Second
	httpIdleTimeout       = 2 * time.Minute
	httpMaxHeaderBytes    = 64 << 10 // 64 КиБ; по умолчанию net/http допускает 1 МиБ
)

// newHTTPServer — http.Server ядра с лимитами; слушатель подставляет main.
func newHTTPServer(h http.Handler) *http.Server {
	return &http.Server{
		Handler:           h,
		ReadHeaderTimeout: httpReadHeaderTimeout,
		IdleTimeout:       httpIdleTimeout,
		MaxHeaderBytes:    httpMaxHeaderBytes,
	}
}
