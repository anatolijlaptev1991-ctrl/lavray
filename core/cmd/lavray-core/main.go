// SPDX-License-Identifier: GPL-3.0-only

// lavray-core — процесс Go-ядра LAVRay (оболочка Tauri спавнит его с
// `serve --listen-socket <path>`; спека — docs/stage3/shell-lifecycle §3):
//
//	lavray-core serve --listen-socket <unix:///…|pipe|127.0.0.1:0> \
//	                  [--data <dir>] [--headless] [--web-bind … --platform openwrt]
//
// Протокол запуска: токен авторизации (32 байта CSPRNG → base64url) читается
// ОДНОЙ строкой из stdin; необязательная вторая строка — агентский токен MCP
// (доступ агентов к ядру, см. stdin.go и internal/api/agent.go); после
// инициализации ядро печатает `LAVRAY_CORE_READY <transport-url>` в stdout и
// работает. stdin держится открытым: EOF = смерть оболочки → graceful-выход
// (страховка §3.2).
//
// Вторая подкоманда — `lavray-core mcp`: MCP-сервер по stdio для ИИ-агентов
// (Claude Desktop, Claude Code, Cursor). Он подключается к уже запущенному
// приложению по agent-endpoint.json и ядро не стартует (mcp_cmd.go).
package main

import (
	"context"
	"crypto/subtle"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/api"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/headless"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/logs"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/presets"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
)

const readyPrefix = "LAVRAY_CORE_READY"

func main() {
	if code, ok := runSubcommand(os.Args, os.Stdin, os.Stdout, os.Stderr); ok {
		os.Exit(code)
	}
	if len(os.Args) < 2 || os.Args[1] != "serve" {
		printUsage(os.Stderr)
		os.Exit(2)
	}
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	listen := fs.String("listen-socket", "", "UDS-путь | \\\\.\\pipe\\name | 127.0.0.1:0")
	dataDir := fs.String("data", defaultDataDir(), "каталог данных (права 0700)")
	headless := fs.Bool("headless", false, "авторестарт последнего профиля (сервисный режим)")
	ext := addExtFlags(fs) // веб-панель и шлюз OpenWrt (ext_flags.go)
	if err := fs.Parse(os.Args[2:]); err != nil || *listen == "" {
		fmt.Fprintln(os.Stderr, "--listen-socket обязателен")
		os.Exit(2)
	}
	ext.checkExtFlags()

	// §3.2: токен — из stdin (оболочка пишет сразу после spawn); stdin остаётся
	// открытым (EOF = смерть оболочки → выход). ОДИН читатель отдаёт первую
	// строку в tokenCh, вторую (агентский токен MCP) — в agentTokenCh, см. stdin.go.
	tokenCh := make(chan string, 1)
	agentTokenCh := make(chan string, 1)
	parentDead := make(chan struct{})
	go readStartupStdin(ext.input(os.Stdin), tokenCh, agentTokenCh, parentDead)

	mux := logs.NewMux(1000)
	mux.Logf(logs.LevelInfo, "core", "lavray-core запускается: listen=%s data=%s", *listen, *dataDir)

	// Geo-базы (.srs) встроены в бинарник: без них любой пресет с
	// geosite:/geoip: валил старт sing-box. Распаковка — при первом запуске
	// (и после смены ревизии набора).
	if geoErr := presets.EnsureGeo(*dataDir); geoErr != nil {
		mux.Logf(logs.LevelWarn, "core", "geo-базы: %v (правила geosite/geoip могут не работать)", geoErr)
	}

	st, err := store.Open(*dataDir)
	if err != nil {
		// T-50: причина и инструкция — в stderr (оболочка/пользователь) и в
		// журнал; раньше выход с кодом 1 был молчаливым.
		msg := describeStoreError(*dataDir, err)
		mux.Logf(logs.LevelError, "core", "store: %s", oneLine(msg))
		fmt.Fprintln(os.Stderr, msg)
		os.Exit(1)
	}
	defer st.Close()

	// Слушатель: UDS / named pipe / TCP-loopback.
	ln, transport, err := listenSocket(*listen)
	if err != nil {
		mux.Logf(logs.LevelError, "core", "listen: %v", err)
		os.Exit(1)
	}

	// S12 (аудит shell): токен читается РОВНО ОДИН раз ДО старта сервера (иначе
	// параллельные RPC блокировались на канале и гонялись за поле).
	authToken := <-tokenCh
	if authToken == "" {
		mux.Logf(logs.LevelWarn, "core", "auth-токен пуст: все запросы будут отклонены (fail-closed)")
	}

	// L24: pickRunner() — реальный sing-box в сборке с тегом singbox_run.
	server := api.NewServer(api.Deps{Store: st, Logs: mux, Runner: pickRunner(), TunCheck: tunPrivilegeCheck, Updater: updaterConf()})
	// Агентский токен (MCP) приходит второй строкой stdin сразу за основным,
	// но может не прийти вовсе (старая оболочка, тесты): тогда агентский
	// доступ закрыт. Режим доступа — настройка agent.mode.
	go func() {
		if tok, ok := <-agentTokenCh; ok {
			if len(tok) < minAgentTokenLen {
				mux.Logf(logs.LevelWarn, "core", "агентский токен слишком короткий — агентский доступ отключён")
				return
			}
			server.SetAgentToken(tok)
		}
	}()
	// Автообновление подписок (FR-UI-126, T-20) и проверка обновлений (T-75).
	defer startSchedulers(server)()
	rt := ext.enableExt(server, st, *dataDir, mux) // до Register: включает WebSession и Gateway
	root := http.NewServeMux()
	server.Register(root)
	// RPC CoreService.Shutdown: инстанс он останавливает сам, а выход из
	// процесса — здесь (T-52: раньше OnShutdown не назначался).
	exitReq := newExitRequest()
	server.OnShutdown = exitReq.trigger
	httpSrv := newHTTPServer(authMiddlewareAgent(root, authToken, server, mux)) // T-50: таймауты и лимит заголовков

	errCh := make(chan error, 1)
	go func() { errCh <- httpSrv.Serve(ln) }()
	defer rt.serve(root, authToken, mux)() // веб-слушатель, если задан --web-bind

	// Готовность (§3.4): printable-строка в stdout.
	fmt.Printf("%s %s\n", readyPrefix, transport)
	os.Stdout.Sync()
	mux.Logf(logs.LevelInfo, "core", "готов: %s", transport)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *headless {
		go runHeadless(ctx, server, mux)
	}
	ext.runGateway(ctx, server)

	select {
	case <-ctx.Done():
		mux.Logf(logs.LevelInfo, "core", "сигнал завершения")
	case <-parentDead:
		mux.Logf(logs.LevelInfo, "core", "оболочка умерла (stdin EOF) — graceful выход")
	case <-exitReq.done():
		mux.Logf(logs.LevelInfo, "core", "RPC Shutdown — выход")
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			mux.Logf(logs.LevelError, "core", "serve: %v", err)
		}
	}
	// T-52: сначала sing-box (TUN снимается), затем HTTP; раньше при EOF и
	// сигнале закрывался только HTTP-сервер, и ждал он до 10 с.
	gracefulExit(server, httpSrv, mux, os.Stderr, 2*time.Second)
}

// listenSocket — UDS (unix:///…|/…), named pipe (\\.\pipe\…), TCP (host:port).
func listenSocket(spec string) (net.Listener, string, error) {
	if strings.HasPrefix(spec, "unix://") || strings.HasPrefix(spec, "/") {
		path := strings.TrimPrefix(spec, "unix://")
		_ = os.Remove(path) // старый сокет
		ln, err := net.Listen("unix", path)
		if err != nil {
			return nil, "", err
		}
		return ln, "unix://" + path, nil
	}
	if strings.HasPrefix(spec, `\\.\pipe\`) {
		ln, err := net.Listen("tcp", "127.0.0.1:0") // именованные каналы — Go/http: используем loopback-TCP
		if err != nil {                             // на Windows named-pipe для net/http нестандартен;
			return nil, "", err // оболочка принимает TCP-loopback с random-портом
		}
		return ln, "tcp://" + ln.Addr().String(), nil
	}
	ln, err := net.Listen("tcp", spec)
	if err != nil {
		return nil, "", err
	}
	return ln, "tcp://" + ln.Addr().String(), nil
}

// agentAuthorizer — проверка агентского токена (api.Server).
type agentAuthorizer interface {
	AuthorizeAgent(r *http.Request, bearer string) (*http.Request, bool)
}

// authMiddleware — Bearer-токен на каждом запросе (кроме healthz и OPTIONS).
// Токен фиксирован (read-once до Serve) — гонок и блокировок нет.
func authMiddleware(next http.Handler, token string, mux *logs.Mux) http.Handler {
	return authMiddlewareAgent(next, token, nil, mux)
}

// authMiddlewareAgent — то же с агентским токеном (MCP): запрос с ним проходит
// с отметкой агента в контексте, а что именно ему разрешено, решает интерсептор
// api по режиму agent.mode. Основной токен ядра агентам не выдаётся.
func authMiddlewareAgent(next http.Handler, token string, agent agentAuthorizer, mux *logs.Mux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			w.WriteHeader(http.StatusOK)
			return
		}
		// CORS preflight не несёт Authorization (браузер шлёт его до запроса).
		if r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		// Fail-closed: пустой токен = отказ всем (оболочка не передала секрет).
		// T-53: схема «Bearer» обязательна; голый токен в заголовке не принимается.
		got, hasScheme := bearerToken(r.Header.Get("Authorization"))
		if hasScheme && got != "" {
			if token != "" && subtle.ConstantTimeCompare([]byte(got), []byte(token)) == 1 {
				next.ServeHTTP(w, r)
				return
			}
			if agent != nil {
				if agentReq, ok := agent.AuthorizeAgent(r, got); ok {
					next.ServeHTTP(w, agentReq)
					return
				}
			}
		}
		rejectUnauthenticated(w, r)
	})
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

func defaultDataDir() string {
	if runtime.GOOS == "windows" {
		if ad, err := os.UserConfigDir(); err == nil {
			return filepath.Join(ad, "LAVRay")
		}
	}
	if hd, err := os.UserHomeDir(); err == nil {
		return filepath.Join(hd, ".local", "share", "lavray")
	}
	return "."
}
