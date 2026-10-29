// SPDX-License-Identifier: GPL-3.0-only

package mcp

// env_test.go — стенд тестов инструментов: настоящий api.Server на временной
// БД с FakeRunner, HTTP-сервер с проверкой агентского токена и файл
// agent-endpoint.json, как их пишет оболочка. Протокол MCP и инструменты
// проверяются на настоящем API ядра, а не на подставке.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/api"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/inst"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/logs"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
)

const (
	envAgentToken = "agent-token-0123456789abcdef0123456789abcd"
	secretHost    = "secret-host.example.org"
	secretPass    = "p4ss-w0rd-SECRET"
	secretUUID    = "b831381d-6324-4d53-ad4f-8cda48b30811"
	secretSubPath = "token-SECRET-abc"
)

// flakyRunner — FakeRunner, у которого первые failStarts запусков падают с
// ошибкой, называющей адрес сервера.
type flakyRunner struct {
	*inst.FakeRunner
	mu         sync.Mutex
	failStarts int
}

func (r *flakyRunner) Start(ctx context.Context, cfg []byte) error {
	r.mu.Lock()
	fail := r.failStarts > 0
	if fail {
		r.failStarts--
	}
	r.mu.Unlock()
	if fail {
		return errors.New("dial tcp 203.0.113.9:443: connection refused")
	}
	return r.FakeRunner.Start(ctx, cfg)
}

// rtFunc — http.RoundTripper из функции («прямой» канал ядра).
type rtFunc func(*http.Request) (*http.Response, error)

func (f rtFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type env struct {
	t        *testing.T
	srv      *api.Server
	logs     *logs.Mux
	st       *store.Store
	runner   *flakyRunner
	ts       *httptest.Server
	dir      string
	endpoint string
	tools    *Tools

	nl, de, hidden *model.Profile // сервер в сети, сервер без ответа, сервер с «секретным» адресом
	provider       *httptest.Server
	providerBody   atomicString
	pingLn         net.Listener
}

type atomicString struct {
	mu sync.Mutex
	v  string
}

func (a *atomicString) set(v string) { a.mu.Lock(); a.v = v; a.mu.Unlock() }
func (a *atomicString) get() string  { a.mu.Lock(); defer a.mu.Unlock(); return a.v }

// newEnv поднимает ядро. mode — значение agent.mode в настройках ядра и в
// файле адреса (то есть то, что оболочка пишет при включении доступа).
func newEnv(t *testing.T, mode string, opts ...func(*api.Deps)) *env {
	t.Helper()
	dir, err := os.MkdirTemp("", "lavray-mcp-*")
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = st.Close()
		for i := 0; i < 50; i++ {
			if os.RemoveAll(dir) == nil {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	})
	e := &env{t: t, st: st, dir: dir, runner: &flakyRunner{FakeRunner: &inst.FakeRunner{}}}

	// «Прямой» канал ядра: публичный IP и ссылка на IP-эхо.
	direct := &http.Client{Transport: rtFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Hostname() == "127.0.0.1" {
			return http.DefaultTransport.RoundTrip(r) // провайдер подписки на loopback
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("203.0.113.77\n")), Header: http.Header{}, Request: r}, nil
	})}
	e.logs = logs.NewMux(1000)
	deps := api.Deps{Store: st, Logs: e.logs, Runner: e.runner, HTTP: direct}
	for _, opt := range opts {
		opt(&deps)
	}
	e.srv = api.NewServer(deps)
	e.srv.SetAgentToken(envAgentToken)

	h := e.srv.NewHandler()
	e.ts = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if r2, ok := e.srv.AuthorizeAgent(r, got); ok {
			h.ServeHTTP(w, r2)
			return
		}
		http.Error(w, `{"code":"unauthenticated"}`, http.StatusUnauthorized)
	}))
	t.Cleanup(e.ts.Close)

	// Сервер, у которого TCP-проверка проходит (слушатель на loopback).
	e.pingLn, err = net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = e.pingLn.Close() })
	go func() {
		for {
			c, err := e.pingLn.Accept()
			if err != nil {
				return
			}
			_ = c.Close()
		}
	}()
	closed, _ := net.Listen("tcp", "127.0.0.1:0")
	closedPort := closed.Addr().(*net.TCPAddr).Port
	_ = closed.Close()

	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(st.CreateGroup(&model.Group{ID: 1, Name: "Default", Kind: model.GroupBasic}))
	e.nl = &model.Profile{GroupID: 1, Type: model.TypeTrojan, Name: "Нидерланды 1", Address: "127.0.0.1",
		Port: e.pingLn.Addr().(*net.TCPAddr).Port, Detail: &model.TrojanVlessDetail{Password: secretPass}}
	e.de = &model.Profile{GroupID: 1, Type: model.TypeVLESS, Name: "Германия", Address: "127.0.0.1",
		Port: closedPort, Detail: &model.TrojanVlessDetail{Password: secretUUID}}
	e.hidden = &model.Profile{GroupID: 1, Type: model.TypeTrojan, Name: "Секретный", Address: secretHost, Port: 443,
		Detail: &model.TrojanVlessDetail{Password: secretPass}, Notes: "ключ " + secretUUID}
	for _, p := range []*model.Profile{e.nl, e.de, e.hidden} {
		must(st.CreateProfile(p))
	}
	must(st.SaveTestResult(e.hidden.ID, model.TestResult{LastError: "dial tcp 10.1.2.3:443: refused"}))

	// Провайдер подписки на loopback: глобально разрешено «локальные адреса».
	e.providerBody.set("trojan://pw@a.example.net:443#A\ntrojan://pw@b.example.net:443#B\n")
	e.provider = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "broken") {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		_, _ = io.WriteString(w, e.providerBody.get())
	}))
	t.Cleanup(e.provider.Close)
	must(st.SetSetting("sub.allow_private_urls", "true"))
	must(st.CreateGroup(&model.Group{ID: 2, Name: "Провайдер", Kind: model.GroupSubscription,
		SubscriptionURL: e.provider.URL + "/api/" + secretSubPath}))
	must(st.CreateGroup(&model.Group{ID: 3, Name: "Архивная", Kind: model.GroupSubscription,
		SubscriptionURL: e.provider.URL + "/api/old", Archive: true}))

	e.endpoint = filepath.Join(dir, EndpointFileName)
	e.tools = NewTools(e.endpoint)
	e.setMode(mode)
	return e
}

// setMode меняет режим в настройках ядра и в файле адреса, как это делают
// настройки приложения и оболочка. "" — файла нет (приложение не запущено).
func (e *env) setMode(mode string) {
	e.t.Helper()
	switch mode {
	case "":
		_ = os.Remove(e.endpoint)
		e.coreMode("off")
	default:
		e.coreMode(mode)
		e.writeEndpoint(mode, e.ts.URL, envAgentToken)
	}
}

func (e *env) coreMode(mode string) {
	e.t.Helper()
	if err := e.st.SetSetting(api.SettingAgentMode, strconv.Quote(mode)); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) writeEndpoint(mode, url, token string) {
	e.t.Helper()
	body, _ := json.Marshal(Endpoint{URL: "tcp://" + strings.TrimPrefix(url, "http://"), Token: token, Mode: mode})
	if err := os.WriteFile(e.endpoint, body, 0o600); err != nil {
		e.t.Fatal(err)
	}
}

// call вызывает инструмент так, как это делает сервер: ошибка не из аргументов
// становится результатом isError.
func (e *env) call(name, args string) ToolResult {
	e.t.Helper()
	res, err := e.tools.Call(context.Background(), name, json.RawMessage(args))
	var perr *ParamsError
	switch {
	case errors.As(err, &perr), errors.Is(err, ErrUnknownTool):
		e.t.Fatalf("%s %s: ошибка протокола: %v", name, args, err)
	case err != nil:
		return textError("%s", err.Error())
	}
	return res
}

// ok вызывает инструмент и требует успеха.
func (e *env) ok(name, args string) ToolResult {
	e.t.Helper()
	res := e.call(name, args)
	if res.IsError {
		e.t.Fatalf("%s %s: ошибка инструмента: %s", name, args, res.Text)
	}
	return res
}

// fail вызывает инструмент и требует isError; возвращает текст.
func (e *env) fail(name, args string) string {
	e.t.Helper()
	res := e.call(name, args)
	if !res.IsError {
		e.t.Fatalf("%s %s: ожидалась ошибка, получено: %s", name, args, res.Text)
	}
	return res.Text
}

// structured — structuredContent в виде карты (через JSON, как у клиента).
func structured(t *testing.T, res ToolResult) map[string]any {
	t.Helper()
	raw, err := json.Marshal(res.Structured)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("structuredContent не объект: %s", raw)
	}
	return m
}

// assertNoSecrets: в тексте и структуре ответа нет адресов, паролей, uuid,
// ссылок подписок и текстов ошибок с адресами.
func assertNoSecrets(t *testing.T, label string, res ToolResult) {
	t.Helper()
	raw, _ := json.Marshal(res.Structured)
	all := res.Text + "\n" + string(raw)
	for _, s := range []string{
		secretHost, secretPass, secretUUID, secretSubPath, "127.0.0.1", "10.1.2.3", "203.0.113.9", "sub.example.com",
		"example.net", "/api/", "http://", "https://", "trojan://",
	} {
		if strings.Contains(all, s) {
			t.Errorf("%s: в ответе есть %q:\n%s", label, s, all)
		}
	}
}

func (e *env) profileID(p *model.Profile) string { return fmt.Sprint(p.ID) }
