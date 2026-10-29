// lavray-core — процесс Go-ядра LAVRay (оболочка Tauri спавнит его с
// `serve --listen-socket <path>`; спека — docs/stage3/shell-lifecycle §3):
//
//	lavray-core serve --listen-socket <unix:///…|pipe|127.0.0.1:0> \
//	                  [--data <dir>] [--headless]
//
// Протокол запуска: токен авторизации (32 байта CSPRNG → base64url) читается
// ОДНОЙ строкой из stdin; после инициализации ядро печатает
// `LAVRAY_CORE_READY <transport-url>` в stdout и работает. stdin держится
// открытым: EOF = смерть оболочки → graceful-выход (страховка §3.2).
package main

import (
	"bufio"
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
	if len(os.Args) < 2 || os.Args[1] != "serve" {
		fmt.Fprintln(os.Stderr, "использование: lavray-core serve --listen-socket <path> [--data dir] [--headless]")
		os.Exit(2)
	}
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	listen := fs.String("listen-socket", "", "UDS-путь | \\\\.\\pipe\\name | 127.0.0.1:0")
	dataDir := fs.String("data", defaultDataDir(), "каталог данных (права 0700)")
	headless := fs.Bool("headless", false, "авторестарт последнего профиля (сервисный режим)")
	if err := fs.Parse(os.Args[2:]); err != nil || *listen == "" {
		fmt.Fprintln(os.Stderr, "--listen-socket обязателен")
		os.Exit(2)
	}

	// §3.2: токен — из stdin (оболочка пишет сразу после spawn). Одну строку,
	// дальше stdin остаётся открытым (EOF = смерть оболочки → выход).
	// ОДИН читатель: первую строку отдаёт в tokenCh, дальше следит за EOF.
	// Токен читается ровно один раз — гонки двух получателей нет.
	tokenCh := make(chan string, 1)
	parentDead := make(chan struct{})
	go func() {
		sc := bufio.NewReader(os.Stdin)
		line, err := sc.ReadString('\n')
		if err != nil && line == "" {
			tokenCh <- ""
		} else {
			tokenCh <- strings.TrimSpace(line)
		}
		buf := make([]byte, 1)
		for {
			_, err := os.Stdin.Read(buf)
			if err != nil {
				close(parentDead)
				return
			}
		}
	}()

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

	// S12 (аудит shell): токен читается РОВНО ОДИН раз ДО старта сервера.
	// Раньше его тянул из канала каждый первый запрос: при параллельных RPC
	// (UI шлёт их сразу) второй получатель блокировался навсегда, а сами
	// поля гонялись. Теперь значение фиксируется здесь.
	authToken := <-tokenCh
	if authToken == "" {
		mux.Logf(logs.LevelWarn, "core", "auth-токен пуст: все запросы будут отклонены (fail-closed)")
	}

	// L24 аудита №1: pickRunner() выбирает реальный sing-box в сборке с
	// тегом singbox_run; раньше хардкод NopRunner означал, что туннель не
	// запускался НИ В ОДНОЙ сборке.
	server := api.NewServer(api.Deps{Store: st, Logs: mux, Runner: pickRunner()})
	// Автообновление подписок (FR-UI-126, T-20): таймер обновляет группы, у
	// которых прошёл интервал; skip_auto_update и архив пропускаются.
	stopAutoUpdate := server.StartSubscriptionScheduler(context.Background())
	defer stopAutoUpdate()
	// appVersion — билд-флаг платформенных репо.
	root := http.NewServeMux()
	server.Register(root)
	// RPC CoreService.Shutdown: инстанс он останавливает сам, а выход из
	// процесса — здесь (T-52: раньше OnShutdown не назначался).
	exitReq := newExitRequest()
	server.OnShutdown = exitReq.trigger
	httpSrv := newHTTPServer(authMiddleware(root, authToken, mux)) // T-50: таймауты и лимит заголовков

	errCh := make(chan error, 1)
	go func() { errCh <- httpSrv.Serve(ln) }()

	// Готовность (§3.4): printable-строка в stdout.
	fmt.Printf("%s %s\n", readyPrefix, transport)
	os.Stdout.Sync()
	mux.Logf(logs.LevelInfo, "core", "готов: %s", transport)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *headless {
		go runHeadless(ctx, server, mux)
	}

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

// authMiddleware — Bearer-токен на каждом запросе (кроме healthz и OPTIONS).
// Токен фиксирован (read-once до Serve) — гонок и блокировок нет.
func authMiddleware(next http.Handler, token string, mux *logs.Mux) http.Handler {
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
		if token == "" || !hasScheme || got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
			http.Error(w, `{"code":"unauthenticated"}`, http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
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
