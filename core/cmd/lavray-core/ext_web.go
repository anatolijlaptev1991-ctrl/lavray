// SPDX-License-Identifier: GPL-3.0-only

package main

// ext_web.go — веб-слушатель панели (--web-bind): отдельный порт со своим
// шлюзом web.Gate. Основной сокет ядра (--listen-socket) остаётся прежним —
// Bearer-токен оболочки; в веб-слушатель добавляются раздача интерфейса, вход
// по паролю и cookie-сессии. Адрес занимается ДО готовности ядра: занятый порт
// или неверный адрес — отказ запуска, а не молчаливое отсутствие панели.

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/api"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/logs"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/web"
)

// webReadyPrefix — строка в stdout с адресом панели (по ней находят порт 0).
const webReadyPrefix = "LAVRAY_WEB_READY"

// webRuntime — занятый слушатель и сведения для статуса панели.
type webRuntime struct {
	ln     net.Listener
	tlsCfg *tls.Config // nil — обычный HTTP
	auth   *web.Auth
	url    string
}

// enableWeb занимает адрес, готовит TLS и включает WebSessionService на server.
func (f *extFlags) enableWeb(server *api.Server, dataDir string) (*webRuntime, error) {
	ln, err := net.Listen("tcp", f.webBind)
	if err != nil {
		return nil, fmt.Errorf("--web-bind %s: %w", f.webBind, err)
	}
	rt := &webRuntime{ln: ln}
	opts := api.WebOptions{BindAddress: ln.Addr().String()}
	scheme := "http"
	if f.webTLS {
		host, _, _ := net.SplitHostPort(f.webBind)
		cert, fp, err := web.LoadOrCreateCert(dataDir, []string{host}, nil)
		if err != nil {
			_ = ln.Close()
			return nil, fmt.Errorf("--web-tls: %w", err)
		}
		rt.tlsCfg = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
		opts.TLSEnabled, opts.TLSFingerprint, scheme = true, fp, "https"
	}
	rt.auth = server.EnableWeb(opts)
	rt.url = scheme + "://" + ln.Addr().String()
	return rt, nil
}

// serve запускает слушатель: api — мультиплексор RPC ядра, bearer — токен ядра
// для headless-клиентов. Возвращает остановку.
func (rt *webRuntime) serve(api http.Handler, bearer string, mux *logs.Mux) func() {
	if rt == nil {
		return func() {}
	}
	gate := web.NewHandler(&web.Gate{Sessions: rt.auth.Sessions, Bearer: bearer, API: api})
	srv := newHTTPServer(gate)
	ln := rt.ln
	if rt.tlsCfg != nil {
		ln = tls.NewListener(ln, rt.tlsCfg)
	}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			mux.Logf(logs.LevelError, "core", "веб-слушатель: %v", err)
		}
	}()
	rt.warnIfInsecure(mux)
	fmt.Printf("%s %s\n", webReadyPrefix, rt.url)
	_ = os.Stdout.Sync()
	mux.Logf(logs.LevelInfo, "core", "веб-панель: %s", rt.url)
	return func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if srv.Shutdown(ctx) != nil {
			_ = srv.Close()
		}
	}
}

// warnIfInsecure предупреждает в журнале: панель в сети без TLS отдаёт пароль и
// cookie открытым текстом (интерфейс показывает «Не защищено»).
func (rt *webRuntime) warnIfInsecure(mux *logs.Mux) {
	if rt.tlsCfg == nil && !web.IsLoopbackBind(rt.ln.Addr().String()) {
		mux.Logf(logs.LevelWarn, "core", "веб-панель %s без TLS: пароль и сессия идут открытым текстом (добавьте --web-tls)", strings.TrimPrefix(rt.url, "http://"))
	}
}
