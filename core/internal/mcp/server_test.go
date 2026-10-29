// SPDX-License-Identifier: GPL-3.0-only

package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeTools — набор инструментов для проверки протокола без ядра.
type fakeTools struct {
	mu    sync.Mutex
	fp    string
	specs []ToolSpec
	calls []string
	run   func(ctx context.Context, name string, args json.RawMessage) (ToolResult, error)
}

func (f *fakeTools) Specs() []ToolSpec {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.specs
}

func (f *fakeTools) Fingerprint() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.fp
}

func (f *fakeTools) setFP(fp string) {
	f.mu.Lock()
	f.fp = fp
	f.mu.Unlock()
}

func (f *fakeTools) Call(ctx context.Context, name string, args json.RawMessage) (ToolResult, error) {
	f.mu.Lock()
	f.calls = append(f.calls, name)
	run := f.run
	f.mu.Unlock()
	if run != nil {
		return run(ctx, name, args)
	}
	switch name {
	case "echo":
		return ToolResult{Text: "эхо " + string(args), Structured: map[string]any{"args": json.RawMessage(args)}}, nil
	case "bad_args":
		return ToolResult{}, &ParamsError{Msg: "нет поля x"}
	case "fails":
		return ToolResult{}, errors.New("ядро не отвечает")
	case "soft_fail":
		return textError("сервер не найден"), nil
	}
	return ToolResult{}, ErrUnknownTool
}

func newFake() *fakeTools {
	return &fakeTools{fp: "a", specs: []ToolSpec{{
		Name: "echo", Title: "Эхо", Description: "d", ReadOnly: true,
		InputSchema: obj(map[string]any{"x": map[string]any{"type": "integer"}}),
	}, {
		Name: "do_it", Title: "Сделать", Description: "d2", Control: true, Destructive: true, OpenWorld: true,
		InputSchema: obj(map[string]any{}),
	}}}
}

// msg разбирает одну выходную строку.
type msg = map[string]any

func decodeLines(t *testing.T, raw string) []msg {
	t.Helper()
	var out []msg
	for _, line := range strings.Split(strings.TrimRight(raw, "\n"), "\n") {
		if line == "" {
			continue
		}
		var m msg
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("в stdout не JSON-RPC: %q (%v)", line, err)
		}
		if m["jsonrpc"] != "2.0" {
			t.Fatalf("нет jsonrpc 2.0: %q", line)
		}
		out = append(out, m)
	}
	return out
}

// runLines подаёт строки на вход, закрывает stdin и возвращает все ответы.
func runLines(t *testing.T, tools Toolset, lines ...string) ([]msg, string) {
	t.Helper()
	var out, errOut bytes.Buffer
	srv := NewServer(tools, Options{Version: "9.9.9", WatchInterval: time.Hour})
	if err := srv.Serve(context.Background(), strings.NewReader(strings.Join(lines, "\n")+"\n"), &out); err != nil {
		t.Fatal(err)
	}
	return decodeLines(t, out.String()), errOut.String()
}

func byID(t *testing.T, msgs []msg, id float64) msg {
	t.Helper()
	for _, m := range msgs {
		if m["id"] == id {
			return m
		}
	}
	t.Fatalf("нет ответа с id %v среди %v", id, msgs)
	return nil
}

func newTestLogger(w io.Writer) *log.Logger { return log.New(w, "", 0) }

func initLine(id int, version string) string {
	return `{"jsonrpc":"2.0","id":` + itoa(id) + `,"method":"initialize","params":{"protocolVersion":"` + version +
		`","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}

// Версию протокола сервер подтверждает, если знает её, иначе предлагает самую новую.
func TestInitializeNegotiatesVersion(t *testing.T) {
	for _, c := range []struct{ asked, want string }{
		{"2025-06-18", "2025-06-18"},
		{"2025-03-26", "2025-03-26"},
		{"2024-11-05", "2024-11-05"},
		{"2099-01-01", "2025-06-18"},
		{"1999-12-31", "2025-06-18"},
	} {
		out, _ := runLines(t, newFake(), initLine(1, c.asked))
		res := byID(t, out, 1)["result"].(msg)
		if res["protocolVersion"] != c.want {
			t.Errorf("запрошена %s: ответ %v, ожидался %s", c.asked, res["protocolVersion"], c.want)
		}
		caps := res["capabilities"].(msg)
		if _, ok := caps["tools"]; !ok {
			t.Errorf("%s: нет capabilities.tools", c.asked)
		}
		info := res["serverInfo"].(msg)
		if info["name"] != "lavray" || info["version"] != "9.9.9" {
			t.Errorf("%s: serverInfo %v", c.asked, info)
		}
		_, hasTitle := info["title"]
		_, hasInstr := res["instructions"]
		if hasTitle != (c.want >= "2025-06-18") || hasInstr != (c.want >= "2025-03-26") {
			t.Errorf("%s: title=%v instructions=%v не соответствуют версии", c.want, hasTitle, hasInstr)
		}
	}
	// без protocolVersion — ошибка параметров
	out, _ := runLines(t, newFake(), `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`)
	if code := byID(t, out, 1)["error"].(msg)["code"]; code != float64(codeInvalidParams) {
		t.Errorf("initialize без версии: код %v", code)
	}
}

func TestPingNotificationsAndUnknownMethod(t *testing.T) {
	out, _ := runLines(t, newFake(),
		`{"jsonrpc":"2.0","method":"notifications/initialized"}`,
		`{"jsonrpc":"2.0","id":7,"method":"ping"}`,
		`{"jsonrpc":"2.0","id":"abc","method":"ping"}`,
		`{"jsonrpc":"2.0","id":8,"method":"resources/list"}`,
		`{"jsonrpc":"2.0","method":"notifications/unknown"}`,
	)
	if len(out) != 3 {
		t.Fatalf("ожидались 3 ответа (уведомления без ответа), получено %d: %v", len(out), out)
	}
	if res := byID(t, out, 7)["result"]; res == nil || len(res.(msg)) != 0 {
		t.Errorf("ping: %v", res)
	}
	var strID msg
	for _, m := range out {
		if m["id"] == "abc" {
			strID = m
		}
	}
	if strID == nil {
		t.Error("строковый id не сохранён")
	}
	if code := byID(t, out, 8)["error"].(msg)["code"]; code != float64(codeMethodNotFound) {
		t.Errorf("неизвестный метод: код %v", code)
	}
}

func TestBadMessages(t *testing.T) {
	out, _ := runLines(t, newFake(),
		`не json`,
		`{"jsonrpc":"2.0","id":3}`,
		`{"id":4,"method":"ping"}`,
		`{"jsonrpc":"2.0","id":5,"result":{}}`, // ответ клиента — игнорируется
		`[]`,
	)
	if len(out) != 4 {
		t.Fatalf("ответов %d: %v", len(out), out)
	}
	if out[0]["id"] != nil || out[0]["error"].(msg)["code"] != float64(codeParseError) {
		t.Errorf("нечитаемая строка: %v", out[0])
	}
	if byID(t, out, 3)["error"].(msg)["code"] != float64(codeInvalidRequest) {
		t.Errorf("запрос без method: %v", byID(t, out, 3))
	}
	if byID(t, out, 4)["error"].(msg)["code"] != float64(codeInvalidRequest) {
		t.Errorf("запрос без jsonrpc: %v", byID(t, out, 4))
	}
	if out[3]["error"].(msg)["code"] != float64(codeParseError) {
		t.Errorf("пустой пакет: %v", out[3])
	}
}

func TestBatch(t *testing.T) {
	const batch = `[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/initialized"},{"jsonrpc":"2.0","id":2,"method":"nope"}]`
	var buf bytes.Buffer
	srv := NewServer(newFake(), Options{WatchInterval: time.Hour})
	if err := srv.Serve(context.Background(), strings.NewReader(batch+"\n"), &buf); err != nil {
		t.Fatal(err)
	}
	// пакет отвечает одним массивом; на уведомление ответа нет
	var replies []msg
	if err := json.Unmarshal(buf.Bytes(), &replies); err != nil {
		t.Fatalf("ответ на пакет — не массив: %q", buf.String())
	}
	if len(replies) != 2 || replies[0]["id"] != float64(1) || replies[1]["error"] == nil {
		t.Errorf("ответ пакета: %v", replies)
	}
}

// Формат списка инструментов зависит от версии: title с 2025-06-18,
// annotations с 2025-03-26.
func TestToolsListFormatByVersion(t *testing.T) {
	for _, c := range []struct {
		version       string
		title, annots bool
	}{
		{"2025-06-18", true, true},
		{"2025-03-26", false, true},
		{"2024-11-05", false, false},
	} {
		out, _ := runLines(t, newFake(), initLine(1, c.version), `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
		tools := byID(t, out, 2)["result"].(msg)["tools"].([]any)
		if len(tools) != 2 {
			t.Fatalf("%s: %d инструментов", c.version, len(tools))
		}
		echo := tools[0].(msg)
		if echo["name"] != "echo" || echo["description"] != "d" || echo["inputSchema"].(msg)["type"] != "object" {
			t.Errorf("%s: %v", c.version, echo)
		}
		if _, ok := echo["title"]; ok != c.title {
			t.Errorf("%s: title=%v", c.version, ok)
		}
		ann, ok := echo["annotations"].(msg)
		if ok != c.annots {
			t.Errorf("%s: annotations=%v", c.version, ok)
		}
		if ok {
			if ann["readOnlyHint"] != true {
				t.Errorf("%s: readOnlyHint=%v", c.version, ann["readOnlyHint"])
			}
			doIt := tools[1].(msg)["annotations"].(msg)
			if doIt["readOnlyHint"] != false || doIt["destructiveHint"] != true || doIt["openWorldHint"] != true {
				t.Errorf("%s: аннотации do_it %v", c.version, doIt)
			}
		}
	}
}

func TestToolsCallResultsAndErrors(t *testing.T) {
	out, _ := runLines(t, newFake(), initLine(1, "2025-06-18"),
		`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{"x":5}}}`,
		`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"nope"}}`,
		`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"bad_args","arguments":{}}}`,
		`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"fails"}}`,
		`{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"soft_fail"}}`,
		`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{}}`,
	)
	ok := byID(t, out, 2)["result"].(msg)
	if ok["isError"] != false {
		t.Errorf("echo: isError=%v", ok["isError"])
	}
	content := ok["content"].([]any)[0].(msg)
	if content["type"] != "text" || !strings.Contains(content["text"].(string), `{"x":5}`) {
		t.Errorf("echo: content %v", content)
	}
	if ok["structuredContent"].(msg)["args"].(msg)["x"] != float64(5) {
		t.Errorf("echo: structuredContent %v", ok["structuredContent"])
	}
	if code := byID(t, out, 3)["error"].(msg)["code"]; code != float64(codeInvalidParams) {
		t.Errorf("неизвестный инструмент: код %v", code)
	}
	if e := byID(t, out, 4)["error"].(msg); e["code"] != float64(codeInvalidParams) || !strings.Contains(e["message"].(string), "нет поля x") {
		t.Errorf("неверные аргументы: %v", e)
	}
	for _, id := range []float64{5, 6} {
		res := byID(t, out, id)["result"].(msg)
		if res["isError"] != true || res["content"].([]any)[0].(msg)["text"] == "" {
			t.Errorf("id %v: ошибка инструмента должна быть isError с текстом: %v", id, res)
		}
	}
	if byID(t, out, 7)["error"].(msg)["code"] != float64(codeInvalidParams) {
		t.Errorf("tools/call без имени: %v", byID(t, out, 7))
	}
}

// structuredContent появился в 2025-06-18: старым клиентам он не отправляется.
func TestStructuredContentOnlyForNewVersions(t *testing.T) {
	for _, c := range []struct {
		version string
		want    bool
	}{{"2025-06-18", true}, {"2025-03-26", false}, {"2024-11-05", false}} {
		out, _ := runLines(t, newFake(), initLine(1, c.version),
			`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{}}}`)
		_, has := byID(t, out, 2)["result"].(msg)["structuredContent"]
		if has != c.want {
			t.Errorf("%s: structuredContent=%v", c.version, has)
		}
	}
}

// В stdout только протокол: журнал сервера уходит в Options.Log.
func TestStdoutCarriesOnlyProtocol(t *testing.T) {
	var out, logBuf bytes.Buffer
	srv := NewServer(newFake(), Options{WatchInterval: time.Hour, Log: newTestLogger(&logBuf)})
	huge := strings.Repeat("я", 5<<20) // длиннее предела строки
	_ = srv.Serve(context.Background(), strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"ping"}`+"\n"+huge+"\n"), &out)
	for _, m := range decodeLines(t, out.String()) {
		if m["jsonrpc"] != "2.0" {
			t.Errorf("постороннее сообщение: %v", m)
		}
	}
	if !strings.Contains(logBuf.String(), "длиннее") {
		t.Errorf("слишком длинная строка не попала в журнал: %q", logBuf.String())
	}
}

// Долгий вызов не блокирует ping; ответ приходит после завершения.
func TestSlowToolDoesNotBlockPing(t *testing.T) {
	f := newFake()
	release := make(chan struct{})
	f.run = func(ctx context.Context, name string, args json.RawMessage) (ToolResult, error) {
		select {
		case <-release:
			return ToolResult{Text: "готово"}, nil
		case <-ctx.Done():
			return ToolResult{}, ctx.Err()
		}
	}
	h := startPipe(t, f)
	h.send(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo"}}`)
	h.send(`{"jsonrpc":"2.0","id":2,"method":"ping"}`)
	if m := h.wait(t, 2); m["result"] == nil {
		t.Fatalf("ping во время вызова: %v", m)
	}
	close(release)
	if m := h.wait(t, 1); m["result"].(msg)["isError"] != false {
		t.Fatalf("итог вызова: %v", m)
	}
	h.close(t)
}

// Отмена по notifications/cancelled прерывает вызов и ответа на него нет.
func TestCancelledCallGetsNoResponse(t *testing.T) {
	f := newFake()
	var cancelled atomic.Bool
	started := make(chan struct{})
	f.run = func(ctx context.Context, name string, args json.RawMessage) (ToolResult, error) {
		close(started)
		<-ctx.Done()
		cancelled.Store(true)
		return ToolResult{}, ctx.Err()
	}
	h := startPipe(t, f)
	h.send(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo"}}`)
	<-started
	h.send(`{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1,"reason":"user"}}`)
	h.send(`{"jsonrpc":"2.0","id":2,"method":"ping"}`)
	if m := h.wait(t, 2); m["result"] == nil {
		t.Fatalf("ping после отмены: %v", m)
	}
	h.close(t)
	if !cancelled.Load() {
		t.Error("контекст вызова не отменён")
	}
	for _, m := range h.all() {
		if m["id"] == float64(1) {
			t.Errorf("на отменённый запрос пришёл ответ: %v", m)
		}
	}
}

// После закрытия stdin запущенный вызов дорабатывает и отвечает (запуск из
// скрипта через канал).
func TestEOFLetsRunningCallFinish(t *testing.T) {
	f := newFake()
	f.run = func(ctx context.Context, name string, args json.RawMessage) (ToolResult, error) {
		select {
		case <-time.After(150 * time.Millisecond):
			return ToolResult{Text: "готово"}, nil
		case <-ctx.Done():
			return ToolResult{}, ctx.Err()
		}
	}
	out, _ := runLines(t, f, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo"}}`)
	if len(out) != 1 || out[0]["result"].(msg)["content"].([]any)[0].(msg)["text"] != "готово" {
		t.Fatalf("ответ после EOF: %v", out)
	}
}

// Смена списка инструментов (режим доступа) рассылается уведомлением, но только
// после initialized и только если клиент уже получал список.
func TestListChangedNotification(t *testing.T) {
	f := newFake()
	h := startPipeWith(t, f, 10*time.Millisecond)
	h.send(initLine(1, "2025-06-18"))
	h.wait(t, 1)
	f.setFP("b")
	time.Sleep(60 * time.Millisecond)
	for _, m := range h.all() {
		if m["method"] == "notifications/tools/list_changed" {
			t.Fatal("уведомление до tools/list и initialized")
		}
	}
	h.send(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	h.send(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	h.wait(t, 2)
	f.setFP("c")
	deadline := time.Now().Add(2 * time.Second)
	for {
		n := 0
		for _, m := range h.all() {
			if m["method"] == "notifications/tools/list_changed" {
				n++
			}
		}
		if n == 1 {
			break
		}
		if n > 1 || time.Now().After(deadline) {
			t.Fatalf("уведомлений %d, ожидалось 1", n)
		}
		time.Sleep(10 * time.Millisecond)
	}
	time.Sleep(60 * time.Millisecond)
	count := 0
	for _, m := range h.all() {
		if m["method"] == "notifications/tools/list_changed" {
			count++
		}
	}
	if count != 1 {
		t.Errorf("уведомление повторилось: %d", count)
	}
	h.close(t)
}

// ---- вспомогательный интерактивный стенд ----------------------------------

type pipeHarness struct {
	in   *io.PipeWriter
	done chan error
	mu   sync.Mutex
	buf  bytes.Buffer
	seen int
}

type lockedWriter struct{ h *pipeHarness }

func (w lockedWriter) Write(p []byte) (int, error) {
	w.h.mu.Lock()
	defer w.h.mu.Unlock()
	return w.h.buf.Write(p)
}

func startPipe(t *testing.T, tools Toolset) *pipeHarness {
	return startPipeWith(t, tools, time.Hour)
}

func startPipeWith(t *testing.T, tools Toolset, watch time.Duration) *pipeHarness {
	t.Helper()
	pr, pw := io.Pipe()
	h := &pipeHarness{in: pw, done: make(chan error, 1)}
	srv := NewServer(tools, Options{WatchInterval: watch})
	go func() { h.done <- srv.Serve(context.Background(), pr, lockedWriter{h}) }()
	return h
}

func (h *pipeHarness) send(line string) { _, _ = io.WriteString(h.in, line+"\n") }

func (h *pipeHarness) all() []msg {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []msg
	for _, line := range strings.Split(strings.TrimRight(h.buf.String(), "\n"), "\n") {
		var m msg
		if line != "" && json.Unmarshal([]byte(line), &m) == nil {
			out = append(out, m)
		}
	}
	return out
}

// sendWait отправляет строку и ждёт ответ с данным id.
func (h *pipeHarness) sendWait(t *testing.T, id float64, line string) msg {
	h.send(line)
	return h.wait(t, id)
}

// wait ждёт ответ с данным id.
func (h *pipeHarness) wait(t *testing.T, id float64) msg {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		for _, m := range h.all() {
			if m["id"] == id {
				return m
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("ответ с id %v не пришёл", id)
	return nil
}

func (h *pipeHarness) close(t *testing.T) {
	t.Helper()
	_ = h.in.Close()
	select {
	case err := <-h.done:
		if err != nil {
			t.Errorf("Serve: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("сервер не остановился после закрытия stdin")
	}
}
