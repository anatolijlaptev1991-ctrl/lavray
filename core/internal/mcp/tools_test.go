// SPDX-License-Identifier: GPL-3.0-only

package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/api"
	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
)

var (
	readNames    = []string{"get_logs", "get_public_ip", "get_status", "get_traffic", "list_servers", "list_subscriptions"}
	controlNames = []string{"connect", "disconnect", "switch_server", "test_servers", "update_subscriptions"}
)

func names(specs []ToolSpec) []string {
	var out []string
	for _, s := range specs {
		out = append(out, s.Name)
	}
	sort.Strings(out)
	return out
}

func eq(a, b []string) bool { return strings.Join(a, ",") == strings.Join(b, ",") }

func all() []string {
	out := append(append([]string(nil), readNames...), controlNames...)
	sort.Strings(out)
	return out
}

// Список инструментов зависит от режима: у чтения — шесть, у управления — все;
// пока приложения нет или доступ выключен, виден безопасный минимум.
func TestToolsListByMode(t *testing.T) {
	e := newEnv(t, "control")
	if got := names(e.tools.Specs()); !eq(got, all()) {
		t.Errorf("control: %v", got)
	}
	e.setMode("read")
	if got := names(e.tools.Specs()); !eq(got, readNames) {
		t.Errorf("read: %v", got)
	}
	e.setMode("")
	if got := names(e.tools.Specs()); !eq(got, readNames) {
		t.Errorf("файла нет: %v", got)
	}
	e.writeEndpoint("off", e.ts.URL, envAgentToken)
	if got := names(e.tools.Specs()); !eq(got, readNames) {
		t.Errorf("режим off в файле: %v", got)
	}
	if e.tools.Fingerprint() == "mode=control" {
		t.Error("отпечаток не отличает режимы")
	}
}

// У каждого инструмента есть описание, схема входа типа object и признаки
// безопасности; управляющие помечены.
func TestEveryToolIsDescribed(t *testing.T) {
	tools := NewTools("unused")
	if got := len(tools.all); got != 11 {
		t.Fatalf("инструментов %d, ожидалось 11", got)
	}
	for _, tl := range tools.all {
		sp := tl.spec
		if sp.Description == "" || len(sp.Description) < 40 || sp.Title == "" {
			t.Errorf("%s: нет описания или заголовка", sp.Name)
		}
		if sp.InputSchema["type"] != "object" || sp.InputSchema["additionalProperties"] != false {
			t.Errorf("%s: схема входа %v", sp.Name, sp.InputSchema)
		}
		if _, err := json.Marshal(sp.InputSchema); err != nil {
			t.Errorf("%s: схема не сериализуется: %v", sp.Name, err)
		}
		isRead := false
		for _, n := range readNames {
			isRead = isRead || n == sp.Name
		}
		if isRead != sp.ReadOnly || isRead == sp.Control {
			t.Errorf("%s: ReadOnly=%v Control=%v", sp.Name, sp.ReadOnly, sp.Control)
		}
	}
}

// Нет файла, приложение не запущено, токен устарел, доступ выключен — все
// инструменты отвечают одной понятной фразой.
func TestToolsExplainWhenAppIsNotRunning(t *testing.T) {
	e := newEnv(t, "control")
	callAll := func(label string) {
		t.Helper()
		for _, name := range all() {
			args := `{}`
			if name == "switch_server" {
				args = `{"server_id":1}`
			}
			text := e.fail(name, args)
			if text != MsgNotRunning {
				t.Errorf("%s: %s ответил %q", label, name, text)
			}
		}
	}
	if !strings.Contains(MsgNotRunning, "LAVRay не запущен или доступ для агентов выключен: откройте LAVRay → Настройки → Агенты (MCP)") {
		t.Fatalf("текст отличается от заданного: %q", MsgNotRunning)
	}

	e.setMode("")
	callAll("нет файла")

	e.writeEndpoint("off", e.ts.URL, envAgentToken)
	callAll("режим off в файле")

	e.writeEndpoint("control", e.ts.URL, "stale-token-from-previous-core-run-0000")
	callAll("токен прежнего запуска ядра")

	// ядро закрыто, файл остался от упавшего приложения
	e.writeEndpoint("control", e.ts.URL, envAgentToken)
	e.ts.Close()
	callAll("файл остался, ядра нет")
}

// Повреждённый файл и чужой адрес — отдельные понятные ошибки, токен никуда не уходит.
func TestEndpointFileValidation(t *testing.T) {
	e := newEnv(t, "control")
	cases := []struct{ name, body, want string }{
		{"не JSON", "{{{", "повреждён"},
		{"пустой токен", `{"url":"tcp://127.0.0.1:5","token":"","mode":"read"}`, "без токена"},
		{"чужой хост", `{"url":"tcp://203.0.113.5:5","token":"t","mode":"read"}`, "не loopback"},
		{"имя хоста", `{"url":"tcp://evil.example:5","token":"t","mode":"read"}`, "не loopback"},
		{"схема", `{"url":"ftp://127.0.0.1:5","token":"t","mode":"read"}`, "вида tcp://"},
		{"нет порта", `{"url":"tcp://127.0.0.1","token":"t","mode":"read"}`, "нет порта"},
		{"режим", `{"url":"tcp://127.0.0.1:5","token":"t","mode":"root"}`, MsgNotRunning},
	}
	for _, c := range cases {
		if err := os.WriteFile(e.endpoint, []byte(c.body), 0o600); err != nil {
			t.Fatal(err)
		}
		text := e.fail("get_status", `{}`)
		if !strings.Contains(text, c.want) {
			t.Errorf("%s: %q, ожидалось %q", c.name, text, c.want)
		}
	}
	// файл-гигант не читается целиком
	if err := os.WriteFile(e.endpoint, bytes.Repeat([]byte(" "), maxEndpointFileBytes+10), 0o600); err != nil {
		t.Fatal(err)
	}
	if text := e.fail("get_status", `{}`); !strings.Contains(text, "слишком большой") {
		t.Errorf("гигантский файл: %q", text)
	}
	// IPv6 loopback допустим
	if _, err := baseURL("tcp://[::1]:7777"); err != nil {
		t.Errorf("[::1]: %v", err)
	}
}

// Режим read: управляющие инструменты отказывают и не доходят до ядра; даже
// если файл устарел и обещает control, ядро само проверяет режим.
func TestReadModeCannotControl(t *testing.T) {
	e := newEnv(t, "read")
	for _, name := range controlNames {
		text := e.fail(name, `{"server_id":`+e.profileID(e.nl)+`}`)
		if !strings.Contains(text, "чтение и управление") {
			t.Errorf("%s в режиме read: %q", name, text)
		}
	}
	// файл говорит control, настройка ядра — read
	e.writeEndpoint("control", e.ts.URL, envAgentToken)
	e.coreMode("read")
	text := e.fail("connect", `{"server_id":`+e.profileID(e.nl)+`}`)
	if !strings.Contains(text, "только чтение") {
		t.Errorf("ядро в режиме read пропустило connect: %q", text)
	}
	// и наоборот: в ядре off — читать тоже нельзя
	e.coreMode("off")
	if text := e.fail("get_status", `{}`); !strings.Contains(text, "выключен") {
		t.Errorf("ядро в режиме off ответило: %q", text)
	}
	if e.runner.StartedCounter != 0 {
		t.Error("инстанс запускался")
	}
}

func TestGetStatus(t *testing.T) {
	e := newEnv(t, "control")
	res := e.ok("get_status", `{}`)
	st := structured(t, res)
	if st["connected"] != false || st["state"] != "idle" || st["agent_access"] != "control" {
		t.Errorf("до подключения: %v", st)
	}
	if !strings.Contains(res.Text, "Не подключено") {
		t.Errorf("текст: %q", res.Text)
	}

	e.ok("connect", `{"server_id":`+e.profileID(e.nl)+`}`)
	res = e.ok("get_status", `{}`)
	st = structured(t, res)
	server := st["server"].(map[string]any)
	if st["connected"] != true || st["state"] != "connected" || server["name"] != "Нидерланды 1" ||
		server["id"] != float64(e.nl.ID) || st["connection_mode"] != "system_proxy" {
		t.Errorf("после подключения: %v", st)
	}
	if _, ok := st["connected_since"].(string); !ok {
		t.Errorf("нет connected_since: %v", st)
	}
	if st["uptime_seconds"] == nil || st["core_version"] == "" {
		t.Errorf("нет uptime/версии: %v", st)
	}
	assertNoSecrets(t, "get_status", res)
	if strings.Contains(res.Text, "inbound") || strings.Contains(res.Text, "2080") {
		t.Errorf("в статусе параметры входа: %q", res.Text)
	}

	// аргументы проверяются
	if _, err := e.tools.Call(context.Background(), "get_status", json.RawMessage(`{"x":1}`)); !isParams(err) {
		t.Errorf("лишний аргумент: %v", err)
	}
}

func isParams(err error) bool {
	var p *ParamsError
	return errors.As(err, &p)
}

func TestListServers(t *testing.T) {
	e := newEnv(t, "read")
	res := e.ok("list_servers", `{}`)
	assertNoSecrets(t, "list_servers", res)
	st := structured(t, res)
	servers := st["servers"].([]any)
	if st["total"] != float64(3) || len(servers) != 3 {
		t.Fatalf("серверов: %v", st)
	}
	byName := map[string]map[string]any{}
	for _, s := range servers {
		m := s.(map[string]any)
		byName[m["name"].(string)] = m
		for _, banned := range []string{"address", "port", "password", "uuid", "notes", "detail"} {
			if _, has := m[banned]; has {
				t.Errorf("в элементе поле %q: %v", banned, m)
			}
		}
	}
	nl := byName["Нидерланды 1"]
	if nl["protocol"] != "trojan" || nl["group"] != "Default" || nl["test_status"] != "untested" || nl["id"] != float64(e.nl.ID) {
		t.Errorf("Нидерланды: %v", nl)
	}
	if byName["Германия"]["protocol"] != "vless" {
		t.Errorf("протокол vless: %v", byName["Германия"])
	}
	if byName["Секретный"]["test_status"] != "failed" {
		t.Errorf("результат проверки: %v", byName["Секретный"])
	}
	if !strings.Contains(res.Text, "Серверов: 3") || !strings.Contains(res.Text, "Нидерланды 1") {
		t.Errorf("текст: %q", res.Text)
	}

	// страницы и фильтр по группе
	page := structured(t, e.ok("list_servers", `{"limit":2,"offset":2}`))
	if page["total"] != float64(3) || page["returned"] != float64(1) {
		t.Errorf("страница: %v", page)
	}
	if none := structured(t, e.ok("list_servers", `{"group_id":2}`)); none["total"] != float64(0) {
		t.Errorf("группа без серверов: %v", none)
	}
	if beyond := structured(t, e.ok("list_servers", `{"offset":99}`)); beyond["returned"] != float64(0) {
		t.Errorf("offset за концом: %v", beyond)
	}
	for _, bad := range []string{`{"limit":0}`, `{"limit":501}`, `{"offset":-1}`, `{"group_id":0}`, `{"search":"x"}`, `{"limit":"много"}`} {
		if _, err := e.tools.Call(context.Background(), "list_servers", json.RawMessage(bad)); !isParams(err) {
			t.Errorf("%s: %v", bad, err)
		}
	}
	// числа строкой модели присылают часто
	if str := structured(t, e.ok("list_servers", `{"limit":"1"}`)); str["returned"] != float64(1) {
		t.Errorf("limit строкой: %v", str)
	}
}

func TestListSubscriptions(t *testing.T) {
	e := newEnv(t, "read")
	res := e.ok("list_subscriptions", `{}`)
	assertNoSecrets(t, "list_subscriptions", res)
	subs := structured(t, res)["subscriptions"].([]any)
	if len(subs) != 2 {
		t.Fatalf("подписок: %v", subs)
	}
	first := subs[0].(map[string]any)
	if first["name"] != "Провайдер" || first["servers"] != float64(0) || first["archived"] != false {
		t.Errorf("подписка: %v", first)
	}
	if subs[1].(map[string]any)["archived"] != true {
		t.Errorf("архивная: %v", subs[1])
	}
}

func TestGetTrafficAndPublicIPAndLogs(t *testing.T) {
	e := newEnv(t, "control")

	// публичный IP — пока туннеля нет, запрос идёт напрямую
	ip := e.ok("get_public_ip", `{}`)
	if m := structured(t, ip); m["ip"] != "203.0.113.77" || !strings.Contains(ip.Text, "203.0.113.77") {
		t.Errorf("get_public_ip: %v / %q", m, ip.Text)
	}
	if direct := structured(t, e.ok("get_public_ip", `{"via":"direct"}`)); direct["via"] != "direct" {
		t.Errorf("via=direct: %v", direct)
	}
	if _, err := e.tools.Call(context.Background(), "get_public_ip", json.RawMessage(`{"via":"proxy"}`)); !isParams(err) {
		t.Errorf("via=proxy: %v", err)
	}

	idle := structured(t, e.ok("get_traffic", `{}`))
	if idle["connected"] != false {
		t.Errorf("get_traffic без подключения: %v", idle)
	}
	e.ok("connect", `{"server_id":`+e.profileID(e.nl)+`}`)
	res := e.ok("get_traffic", `{}`)
	st := structured(t, res)
	if st["connected"] != true || st["active_server_total"] == nil {
		t.Errorf("get_traffic: %v", st)
	}
	if _, has := st["speed"]; !has || st["speed"] != nil {
		t.Errorf("в этой сборке скорость недоступна и должна быть null: %v", st["speed"])
	}
	if !strings.Contains(res.Text, "недоступна") {
		t.Errorf("текст: %q", res.Text)
	}

	// журнал: секреты маскирует ядро; длина и уровень ограничены
	for i := 0; i < 5; i++ {
		e.logs.Logf("info", "core", "строка %d", i)
	}
	e.logs.Logf("warn", "core", "ошибка пароль password=%s по ссылке https://x.example.org/a?token=SUPERSECRET", secretPass)
	e.logs.Logf("info", "core", "%s", strings.Repeat("длинная ", 200))
	logs := e.ok("get_logs", `{"lines":200}`)
	raw, _ := json.Marshal(logs.Structured)
	for _, banned := range []string{secretPass, "SUPERSECRET"} {
		if strings.Contains(logs.Text, banned) || strings.Contains(string(raw), banned) {
			t.Errorf("в журнале %q", banned)
		}
	}
	lines := structured(t, logs)["lines"].([]any)
	if len(lines) < 5 {
		t.Fatalf("строк журнала: %d", len(lines))
	}
	for _, l := range lines {
		if n := len([]rune(l.(map[string]any)["message"].(string))); n > maxLogRunes+1 {
			t.Errorf("строка журнала %d рун", n)
		}
	}
	warn := structured(t, e.ok("get_logs", `{"min_level":"warn"}`))["lines"].([]any)
	if len(warn) == 0 {
		t.Fatal("нет строк warn")
	}
	for _, l := range warn {
		if lv := l.(map[string]any)["level"]; lv != "warn" && lv != "error" {
			t.Errorf("min_level=warn вернул %v", lv)
		}
	}
	if three := structured(t, e.ok("get_logs", `{"lines":3}`))["lines"].([]any); len(three) != 3 {
		t.Errorf("lines=3: %d", len(three))
	}
	for _, bad := range []string{`{"lines":0}`, `{"lines":201}`, `{"min_level":"trace"}`} {
		if _, err := e.tools.Call(context.Background(), "get_logs", json.RawMessage(bad)); !isParams(err) {
			t.Errorf("%s: %v", bad, err)
		}
	}
}

// connect / disconnect: выбор сервера, повторные вызовы, режим из приложения.
func TestConnectAndDisconnect(t *testing.T) {
	e := newEnv(t, "control")

	// без server_id берётся сервер, выбранный в окне (ui-state.json), а не первый
	ui := `{"lavray.server":"` + e.profileID(e.de) + `"}`
	if err := os.WriteFile(filepath.Join(e.dir, uiStateFile), []byte(ui), 0o600); err != nil {
		t.Fatal(err)
	}
	res := e.ok("connect", `{}`)
	st := structured(t, res)
	if st["connected"] != true || st["server"].(map[string]any)["name"] != "Германия" {
		t.Fatalf("connect без id: %v", st)
	}
	if !strings.Contains(res.Text, "окно LAVRay") {
		t.Errorf("нет пометки о системном прокси: %q", res.Text)
	}
	assertNoSecrets(t, "connect", res)

	// повторное подключение к тому же серверу — не ошибка и не новый запуск
	started := e.runner.StartedCounter
	if again := e.ok("connect", `{}`); !strings.Contains(again.Text, "Уже подключено") {
		t.Errorf("повтор: %q", again.Text)
	}
	if e.ok("connect", `{"server_id":`+e.profileID(e.de)+`}`); e.runner.StartedCounter != started {
		t.Error("повторный connect перезапустил инстанс")
	}
	// другой сервер при активном подключении — подсказка про switch_server
	if text := e.fail("connect", `{"server_id":`+e.profileID(e.nl)+`}`); !strings.Contains(text, "switch_server") {
		t.Errorf("connect на другой сервер: %q", text)
	}

	off := e.ok("disconnect", `{}`)
	if structured(t, off)["connected"] != false || !strings.Contains(off.Text, "Отключено") {
		t.Errorf("disconnect: %v / %q", off.Structured, off.Text)
	}
	if again := e.ok("disconnect", `{}`); !strings.Contains(again.Text, "Уже отключено") {
		t.Errorf("повторный disconnect: %q", again.Text)
	}

	// без выбора в окне — первый сервер списка
	_ = os.Remove(filepath.Join(e.dir, uiStateFile))
	if first := structured(t, e.ok("connect", `{}`)); first["server"].(map[string]any)["id"] != float64(e.nl.ID) {
		t.Errorf("connect без выбора: %v", first)
	}
	e.ok("disconnect", `{}`)

	// несуществующий сервер и мусорный id
	if text := e.fail("connect", `{"server_id":999}`); !strings.Contains(text, "list_servers") {
		t.Errorf("несуществующий id: %q", text)
	}
	if text := e.fail("connect", `{"server_id":-5}`); text == "" {
		t.Error("отрицательный id принят")
	}
	if _, err := e.tools.Call(context.Background(), "connect", json.RawMessage(`{"server_id":"abc"}`)); !isParams(err) {
		t.Errorf("server_id=abc: %v", err)
	}
}

// Запомненный режим TUN без повышения: понятная причина вместо сырой ошибки.
func TestConnectInTunModeWithoutPrivileges(t *testing.T) {
	// без проверки прав стенд подключился бы; с проверкой — объяснение
	e := newEnv(t, "control", func(d *api.Deps) {
		d.TunCheck = func() error {
			return errors.New("режим TUN требует прав администратора, а ядро запущено без повышения")
		}
	})
	if err := e.st.SetSetting("remember.modes", `["tun"]`); err != nil {
		t.Fatal(err)
	}
	text := e.fail("connect", `{"server_id":`+e.profileID(e.nl)+`}`)
	if !strings.Contains(text, "прав администратора") {
		t.Errorf("TUN без прав: %q", text)
	}
	if e.runner.StartedCounter != 0 {
		t.Error("TUN без прав запустил инстанс")
	}
}

func TestSwitchServer(t *testing.T) {
	e := newEnv(t, "control")

	// не подключено — ведёт себя как connect
	if st := structured(t, e.ok("switch_server", `{"server_id":`+e.profileID(e.nl)+`}`)); st["connected"] != true {
		t.Fatalf("switch без подключения: %v", st)
	}
	// на другой сервер
	res := e.ok("switch_server", `{"server_id":`+e.profileID(e.de)+`}`)
	if st := structured(t, res); st["server"].(map[string]any)["name"] != "Германия" || !strings.Contains(res.Text, "Переключено") {
		t.Fatalf("switch: %v / %q", st, res.Text)
	}
	if again := e.ok("switch_server", `{"server_id":`+e.profileID(e.de)+`}`); !strings.Contains(again.Text, "Уже подключено") {
		t.Errorf("тот же сервер: %q", again.Text)
	}
	// server_id обязателен, чужой id — понятная ошибка
	if _, err := e.tools.Call(context.Background(), "switch_server", json.RawMessage(`{}`)); !isParams(err) {
		t.Errorf("без server_id: %v", err)
	}
	if text := e.fail("switch_server", `{"server_id":4242}`); !strings.Contains(text, "list_servers") {
		t.Errorf("чужой id: %q", text)
	}

	// новый сервер не стартует: прежний возвращается, адрес из ошибки не виден
	e.runner.mu.Lock()
	e.runner.failStarts = 1
	e.runner.mu.Unlock()
	text := e.fail("switch_server", `{"server_id":`+e.profileID(e.nl)+`}`)
	if !strings.Contains(text, "Прежний сервер") || !strings.Contains(text, "подключён снова") {
		t.Errorf("откат: %q", text)
	}
	if strings.Contains(text, "203.0.113.9") {
		t.Errorf("в ошибке адрес сервера: %q", text)
	}
	st := structured(t, e.ok("get_status", `{}`))
	if st["connected"] != true || st["server"].(map[string]any)["name"] != "Германия" {
		t.Errorf("после отката: %v", st)
	}

	// не стартует ни новый, ни прежний
	e.runner.mu.Lock()
	e.runner.failStarts = 2
	e.runner.mu.Unlock()
	text = e.fail("switch_server", `{"server_id":`+e.profileID(e.nl)+`}`)
	if !strings.Contains(text, "вернуть тоже не удалось") {
		t.Errorf("оба сбоя: %q", text)
	}
	if st := structured(t, e.ok("get_status", `{}`)); st["connected"] != false {
		t.Errorf("после двойного сбоя должно быть отключено: %v", st)
	}
}

// Ошибка запуска ядра доходит до агента без адреса сервера.
func TestConnectFailureHidesAddress(t *testing.T) {
	e := newEnv(t, "control")
	e.runner.mu.Lock()
	e.runner.failStarts = 1
	e.runner.mu.Unlock()
	text := e.fail("connect", `{"server_id":`+e.profileID(e.nl)+`}`)
	if strings.Contains(text, "203.0.113.9") || text == "" {
		t.Errorf("ошибка подключения: %q", text)
	}
}

func TestTestServers(t *testing.T) {
	e := newEnv(t, "control")
	ids := `[` + e.profileID(e.nl) + `,` + e.profileID(e.de) + `]`
	res := e.ok("test_servers", `{"mode":"latency","server_ids":`+ids+`}`)
	st := structured(t, res)
	if st["requested"] != float64(2) || st["completed"] != float64(2) || st["ok"] != float64(1) || st["failed"] != float64(1) || st["timed_out"] != false {
		t.Fatalf("итог: %v", st)
	}
	results := st["results"].([]any)
	first := results[0].(map[string]any)
	if first["name"] != "Нидерланды 1" || first["status"] != "ok" || first["latency_ms"].(float64) < 1 {
		t.Errorf("лучший сервер первым: %v", results)
	}
	if results[1].(map[string]any)["status"] != "failed" {
		t.Errorf("недоступный сервер: %v", results[1])
	}
	assertNoSecrets(t, "test_servers", res)

	// результаты сохранились и видны в list_servers
	list := structured(t, e.ok("list_servers", `{}`))["servers"].([]any)
	var seen int
	for _, s := range list {
		m := s.(map[string]any)
		if m["id"] == float64(e.nl.ID) && m["test_status"] == "ok" && m["latency_ms"] != nil && m["tested_at"] != nil {
			seen++
		}
		if m["id"] == float64(e.de.ID) && m["test_status"] == "failed" {
			seen++
		}
	}
	if seen != 2 {
		t.Errorf("результаты теста не сохранены: %v", list)
	}

	// url-тест в сборке без sing-box: «не применимо», а не падение
	url := structured(t, e.ok("test_servers", `{"mode":"url","server_ids":[`+e.profileID(e.nl)+`]}`))
	if url["completed"] != float64(1) || url["mode"] != "url" {
		t.Errorf("url-тест: %v", url)
	}

	// проверка аргументов
	for _, bad := range []string{`{"mode":"full"}`, `{"timeout_seconds":1}`, `{"timeout_seconds":999}`, `{"server_ids":[0]}`, `{"server_ids":"1"}`} {
		if _, err := e.tools.Call(context.Background(), "test_servers", json.RawMessage(bad)); !isParams(err) {
			t.Errorf("%s: %v", bad, err)
		}
	}
	if text := e.fail("test_servers", `{"server_ids":[9999]}`); !strings.Contains(text, "list_servers") {
		t.Errorf("чужой id: %q", text)
	}
}

func TestTestSummaryTimedOutAndTruncated(t *testing.T) {
	ids := make([]int64, 0, 250)
	nm := map[int64]string{}
	results := map[int64]*lavrayv1.TestResult{}
	for i := int64(1); i <= 250; i++ {
		ids = append(ids, i)
		nm[i] = "s"
		ms := int32(i)
		results[i] = &lavrayv1.TestResult{LatencyMs: &ms}
	}
	res := testSummary("", ids, nm, results, true)
	st := structured(t, res)
	if st["timed_out"] != true || st["truncated"] != true || len(st["results"].([]any)) != maxTestResultsShown {
		t.Errorf("итог: timed_out=%v truncated=%v shown=%d", st["timed_out"], st["truncated"], len(st["results"].([]any)))
	}
	if !strings.Contains(res.Text, "Время ожидания вышло") {
		t.Errorf("текст: %q", res.Text)
	}
	if first := st["results"].([]any)[0].(map[string]any); first["latency_ms"] != float64(1) {
		t.Errorf("сортировка по задержке: %v", first)
	}
}

func TestUpdateSubscriptions(t *testing.T) {
	e := newEnv(t, "control")

	res := e.ok("update_subscriptions", `{"id":2}`)
	items := structured(t, res)["subscriptions"].([]any)
	it := items[0].(map[string]any)
	if it["status"] != "updated" || it["added"] != float64(2) || it["servers_total"] != float64(2) {
		t.Fatalf("обновление: %v", it)
	}
	assertNoSecrets(t, "update_subscriptions", res)
	if got := structured(t, e.ok("list_servers", `{"group_id":2}`)); got["total"] != float64(2) {
		t.Errorf("серверы подписки: %v", got)
	}
	if sub := structured(t, e.ok("list_subscriptions", `{}`))["subscriptions"].([]any)[0].(map[string]any); sub["servers"] != float64(2) || sub["updated_at"] == nil {
		t.Errorf("подписка после обновления: %v", sub)
	}

	// все: архивная пропускается, как «Обновить все» в приложении
	all := structured(t, e.ok("update_subscriptions", `{}`))["subscriptions"].([]any)
	status := map[string]string{}
	for _, a := range all {
		m := a.(map[string]any)
		status[m["name"].(string)] = m["status"].(string)
	}
	if status["Провайдер"] != "updated" || status["Архивная"] != "skipped" {
		t.Errorf("все подписки: %v", status)
	}

	// сбой провайдера: ошибка без адреса и пути ссылки
	if err := e.st.SetSetting("sub.allow_private_urls", "true"); err != nil {
		t.Fatal(err)
	}
	g, _ := e.st.GetGroup(2)
	g.SubscriptionURL = e.provider.URL + "/broken/" + secretSubPath
	g.LastWorkingURL = "" // иначе ядро сначала пробует прежний рабочий адрес
	if err := e.st.UpdateGroup(g); err != nil {
		t.Fatal(err)
	}
	fail := e.ok("update_subscriptions", `{"id":2}`)
	f := structured(t, fail)["subscriptions"].([]any)[0].(map[string]any)
	if f["status"] != "failed" || f["error"] == nil {
		t.Errorf("сбой провайдера: %v", f)
	}
	assertNoSecrets(t, "update_subscriptions (сбой)", fail)

	// провайдер заменил все серверы — деструктивное обновление требует
	// подтверждения в приложении, агент подтвердить его не может
	g.SubscriptionURL = e.provider.URL + "/api/ok"
	if err := e.st.UpdateGroup(g); err != nil {
		t.Fatal(err)
	}
	e.providerBody.set("trojan://pw@c1.example.net:443#C1\ntrojan://pw@c2.example.net:443#C2\ntrojan://pw@c3.example.net:443#C3\n")
	confirm := structured(t, e.ok("update_subscriptions", `{"id":2}`))["subscriptions"].([]any)[0].(map[string]any)
	if confirm["status"] != "confirm_required" {
		t.Errorf("обновление до нуля серверов: %v", confirm)
	}
	if confirm["would_remove"] != float64(2) {
		t.Errorf("сколько серверов исчезло бы: %v", confirm)
	}
	if got := structured(t, e.ok("list_servers", `{"group_id":2}`)); got["total"] != float64(2) {
		t.Errorf("отклонённое обновление изменило список: %v", got)
	}

	if text := e.fail("update_subscriptions", `{"id":77}`); !strings.Contains(text, "list_subscriptions") {
		t.Errorf("чужой id: %q", text)
	}
}

// Сквозной прогон через настоящий протокол: initialize → tools/list → вызовы.
// Клиент ждёт ответ на каждый вызов, как это делают настоящие клиенты MCP.
func TestEndToEndOverStdio(t *testing.T) {
	e := newEnv(t, "control")
	h := startPipe(t, e.tools)
	call := func(id int, name, args string) msg {
		h.send(`{"jsonrpc":"2.0","id":` + itoa(id) + `,"method":"tools/call","params":{"name":"` + name + `","arguments":` + args + `}}`)
		return h.wait(t, float64(id))
	}
	status := func(m msg) map[string]any { return m["result"].(msg)["structuredContent"].(map[string]any) }

	h.send(initLine(1, "2025-06-18"))
	h.wait(t, 1)
	h.send(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	h.send(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	if n := len(h.wait(t, 2)["result"].(msg)["tools"].([]any)); n != 11 {
		t.Errorf("tools/list: %d инструментов", n)
	}
	if st := status(call(3, "get_status", `{}`)); st["connected"] != false {
		t.Errorf("до подключения: %v", st)
	}
	if st := status(call(4, "connect", `{"server_id":`+e.profileID(e.nl)+`}`)); st["connected"] != true {
		t.Errorf("connect: %v", st)
	}
	if st := status(call(5, "get_status", `{}`)); st["connected"] != true {
		t.Errorf("после подключения: %v", st)
	}
	if st := status(call(6, "disconnect", `{}`)); st["connected"] != false {
		t.Errorf("disconnect: %v", st)
	}
	// инструмента удаления нет и не может быть: ошибка протокола
	if code := h.sendWait(t, 7, `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"delete_profile","arguments":{}}}`)["error"].(msg)["code"]; code != float64(codeInvalidParams) {
		t.Errorf("неизвестный инструмент: код %v", code)
	}
	h.close(t)
}

// Список инструментов не содержит ничего про импорт, удаление, настройки, DNS,
// правила, экспорт и конфиг — ни по имени, ни по описанию.
func TestNoForbiddenCapabilitiesAreExposed(t *testing.T) {
	tools := NewTools("unused")
	banned := []string{"import", "delete", "remove", "create", "export", "setting", "dns", "rule", "config", "shutdown", "custom"}
	for _, tl := range tools.all {
		n := strings.ToLower(tl.spec.Name)
		for _, b := range banned {
			if strings.Contains(n, b) {
				t.Errorf("инструмент %q похож на запрещённый (%s)", tl.spec.Name, b)
			}
		}
	}
}
