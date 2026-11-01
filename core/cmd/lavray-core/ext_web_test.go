// SPDX-License-Identifier: GPL-3.0-only

package main

// ext_web_test.go — exec-тесты (GC) веб-слушателя: настоящий бинарь ядра с
// --web-bind на loopback и случайном порту. Основной сокет и веб-слушатель
// проверяются вместе: cookie-сессии принимает только второй.

import (
	"bufio"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/web"
)

const (
	execToken = "exec-token-0123456789abcdef0123456789abcdef"
	execPass  = "correct-horse-1"
)

// runningCore — запущенное ядро с веб-слушателем.
type runningCore struct {
	webURL  string
	coreURL string // основной сокет, http://127.0.0.1:порт
	stop    func()
}

func startWebCore(t *testing.T, exe, dataDir string, extra ...string) *runningCore {
	t.Helper()
	args := append([]string{"serve", "--listen-socket", "127.0.0.1:0", "--data", dataDir, "--web-bind", "127.0.0.1:0"}, extra...)
	cmd := exec.Command(exe, args...)
	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	rc := &runningCore{stop: func() { _ = stdin.Close(); _ = cmd.Process.Kill(); _ = cmd.Wait() }}
	t.Cleanup(rc.stop)
	if _, err := stdin.Write([]byte(execToken + "\n")); err != nil {
		t.Fatal(err)
	}
	lines := make(chan string, 8)
	go func() {
		sc := bufio.NewScanner(stdout)
		for sc.Scan() {
			lines <- sc.Text()
		}
		close(lines)
	}()
	deadline := time.After(15 * time.Second)
	for rc.webURL == "" || rc.coreURL == "" {
		select {
		case l, ok := <-lines:
			if !ok {
				t.Fatalf("ядро завершилось до готовности: web=%q core=%q", rc.webURL, rc.coreURL)
			}
			if v, found := strings.CutPrefix(l, "LAVRAY_WEB_READY "); found {
				rc.webURL = v
			}
			if v, found := strings.CutPrefix(l, "LAVRAY_CORE_READY tcp://"); found {
				rc.coreURL = "http://" + v
			}
		case <-deadline:
			t.Fatal("не дождались LAVRAY_WEB_READY / LAVRAY_CORE_READY")
		}
	}
	go func() { _, _ = io.Copy(io.Discard, stdout) }()
	return rc
}

// webClient — клиент с банкой cookie; HTTPS принимает любой сертификат, но
// запоминает отпечаток листа.
type webClient struct {
	t    *testing.T
	base string
	hc   *http.Client
	csrf string
	fp   string
}

func newWebClient(t *testing.T, base string) *webClient {
	jar, _ := cookiejar.New(nil)
	c := &webClient{t: t, base: base}
	c.hc = &http.Client{Jar: jar, Timeout: 20 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{
		InsecureSkipVerify: true, //nolint:gosec // самоподписанный сертификат; отпечаток сверяется ниже
		VerifyPeerCertificate: func(raw [][]byte, _ [][]*x509.Certificate) error {
			c.fp = web.Fingerprint(raw[0])
			return nil
		},
	}}}
	return c
}

type reply struct {
	status int
	header http.Header
	body   map[string]any
	raw    string
}

func (c *webClient) do(method, path, body string, hdr map[string]string) reply {
	c.t.Helper()
	req, err := http.NewRequest(method, c.base+path, strings.NewReader(body))
	if err != nil {
		c.t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)
	r := reply{status: resp.StatusCode, header: resp.Header, raw: string(raw), body: map[string]any{}}
	_ = json.Unmarshal(raw, &r.body)
	return r
}

// rpc — вызов как из браузера: Origin и CSRF подставляются.
func (c *webClient) rpc(proc, body string) reply {
	h := map[string]string{"Origin": c.base}
	if c.csrf != "" {
		h[web.CSRFHeader] = c.csrf
	}
	return c.do(http.MethodPost, "/lavray.v1."+proc, body, h)
}

func TestWebListenerE2E(t *testing.T) {
	exe := buildCore(t)
	dir, _ := os.MkdirTemp("", "core-web-*")
	t.Cleanup(func() { removeAllRetry(dir) })
	rc := startWebCore(t, exe, dir)
	c := newWebClient(t, rc.webURL)

	t.Run("TestServeWebRootReturnsHTML", func(t *testing.T) {
		r := c.do(http.MethodGet, "/", "", nil)
		if r.status != 200 || !strings.HasPrefix(r.header.Get("Content-Type"), "text/html") {
			t.Fatalf("GET /: %d %q", r.status, r.header.Get("Content-Type"))
		}
		if r.header.Get("X-Frame-Options") != "DENY" || !strings.Contains(r.header.Get("Content-Security-Policy"), "frame-ancestors 'none'") {
			t.Fatalf("защитные заголовки на корне: %v", r.header)
		}
		if lr := c.do(http.MethodGet, "/login", "", nil); lr.status != 200 {
			t.Fatalf("GET /login: %d", lr.status)
		}
		if h := c.do(http.MethodGet, "/healthz", "", nil); h.status != 200 {
			t.Fatalf("healthz: %d", h.status)
		}
	})

	t.Run("anonymous RPC is rejected, bearer works", func(t *testing.T) {
		if r := c.rpc("CoreService/GetStatus", `{}`); r.status != 401 {
			t.Fatalf("без сессии: %d", r.status)
		}
		r := c.do(http.MethodPost, "/lavray.v1.CoreService/GetStatus", `{}`, map[string]string{"Authorization": "Bearer " + execToken})
		if r.status != 200 {
			t.Fatalf("Bearer: %d %s", r.status, r.raw)
		}
	})

	t.Run("setup, login, CSRF", func(t *testing.T) {
		st := c.rpc("WebSessionService/GetWebModeStatus", `{}`)
		if st.status != 200 || st.body["firstRunSetupRequired"] != true {
			t.Fatalf("статус: %+v", st)
		}
		setup := c.rpc("WebSessionService/SetupFirstAdmin", `{"username":"admin","password":"`+execPass+`"}`)
		if setup.status != 200 {
			t.Fatalf("SetupFirstAdmin: %d %s", setup.status, setup.raw)
		}
		if !strings.Contains(strings.Join(setup.header.Values("Set-Cookie"), ";"), "HttpOnly") {
			t.Fatalf("cookie без HttpOnly: %v", setup.header.Values("Set-Cookie"))
		}
		c.csrf, _ = setup.body["csrfToken"].(string)
		if r := c.rpc("CoreService/GetStatus", `{}`); r.status != 200 {
			t.Fatalf("RPC с сессией: %d %s", r.status, r.raw)
		}
		good := c.csrf
		c.csrf = ""
		if r := c.rpc("CoreService/GetStatus", `{}`); r.status != 403 {
			t.Fatalf("без CSRF: %d", r.status)
		}
		c.csrf = good
		// Cookie-сессии принимает только веб-слушатель; основной сокет — только Bearer.
		main := newWebClient(t, rc.coreURL)
		for _, ck := range c.hc.Jar.Cookies(mustURL(rc.webURL)) {
			main.hc.Jar.SetCookies(mustURL(rc.coreURL), []*http.Cookie{ck})
		}
		if r := main.do(http.MethodPost, "/lavray.v1.CoreService/GetStatus", `{}`, map[string]string{web.CSRFHeader: good, "Origin": rc.coreURL}); r.status != 401 {
			t.Fatalf("cookie на основном сокете: %d, ждали 401", r.status)
		}
	})

	t.Run("lockout after failed logins", func(t *testing.T) {
		bad := newWebClient(t, rc.webURL)
		for i := 0; i < 5; i++ {
			if r := bad.rpc("WebSessionService/Login", `{"username":"admin","password":"wrong-password-1"}`); r.status != 401 {
				t.Fatalf("неудача %d: %d", i+1, r.status)
			}
		}
		r := bad.rpc("WebSessionService/Login", `{"username":"admin","password":"`+execPass+`"}`)
		if r.status != 429 || r.header.Get("Retry-After") == "" {
			t.Fatalf("после 5 неудач: %d retry=%q", r.status, r.header.Get("Retry-After"))
		}
	})
}

// TestWebTLSFingerprintStableAcrossRestarts — отпечаток сертификата не меняется
// между запусками и совпадает с тем, что показывает GetWebModeStatus.
func TestWebTLSFingerprintStableAcrossRestarts(t *testing.T) {
	exe := buildCore(t)
	dir, _ := os.MkdirTemp("", "core-web-tls-*")
	t.Cleanup(func() { removeAllRetry(dir) })
	var fps [2]string
	for i := range fps {
		rc := startWebCore(t, exe, dir, "--web-tls")
		if !strings.HasPrefix(rc.webURL, "https://") {
			t.Fatalf("адрес без TLS: %s", rc.webURL)
		}
		c := newWebClient(t, rc.webURL)
		st := c.rpc("WebSessionService/GetWebModeStatus", `{}`)
		shown, _ := st.body["tlsFingerprintSha256"].(string)
		if st.status != 200 || st.body["tlsEnabled"] != true || shown == "" || shown != c.fp {
			t.Fatalf("запуск %d: статус %+v, отпечаток соединения %q", i, st.body, c.fp)
		}
		fps[i] = shown
		rc.stop()
	}
	if fps[0] != fps[1] {
		t.Fatalf("отпечаток сменился при перезапуске: %s != %s", fps[0], fps[1])
	}
}

// TestWebFlagValidation — недопустимые сочетания флагов: код 2 и понятное
// сообщение, ядро не стартует (S).
func TestWebFlagValidation(t *testing.T) {
	exe := buildCore(t)
	dir, _ := os.MkdirTemp("", "core-flags-*")
	t.Cleanup(func() { removeAllRetry(dir) })
	cases := []struct {
		name string
		args []string
		want string
	}{
		{"0.0.0.0 без --web-allow-remote", []string{"--web-bind", "0.0.0.0:0"}, "--web-allow-remote"},
		{"LAN-адрес без флага", []string{"--web-bind", "192.168.1.1:8443"}, "--web-allow-remote"},
		{"имя хоста", []string{"--web-bind", "router.lan:8443"}, "не IP"},
		{"--web-tls без --web-bind", []string{"--web-tls"}, "--web-bind"},
		{"--web-allow-remote без --web-bind", []string{"--web-allow-remote"}, "--web-bind"},
		{"неизвестная платформа", []string{"--platform", "plan9"}, "--platform"},
	}
	for _, c := range cases {
		args := append([]string{"serve", "--listen-socket", "127.0.0.1:0", "--data", dir}, c.args...)
		out, err := exec.Command(exe, args...).CombinedOutput()
		ee, ok := err.(*exec.ExitError)
		if !ok || ee.ExitCode() != 2 || !strings.Contains(string(out), c.want) {
			t.Errorf("%s: err=%v out=%q, ждали код 2 и %q", c.name, err, out, c.want)
		}
	}
}

func mustURL(s string) *url.URL {
	u, err := url.Parse(s)
	if err != nil {
		panic(err)
	}
	return u
}

func removeAllRetry(dir string) {
	for i := 0; i < 50; i++ {
		if os.RemoveAll(dir) == nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// TestNeedSetupCode — код первичной настройки нужен только панели не на loopback
// и только пока нет администратора.
func TestNeedSetupCode(t *testing.T) {
	cases := []struct {
		bind   string
		admins int
		want   bool
	}{
		{"192.168.1.1:9090", 0, true},
		{"0.0.0.0:9090", 0, true},
		{"192.168.1.1:9090", 1, false},
		{"127.0.0.1:9090", 0, false},
		{"[::1]:9090", 0, false},
		{"localhost:9090", 0, false},
	}
	for _, c := range cases {
		if got := needSetupCode(c.bind, c.admins); got != c.want {
			t.Errorf("needSetupCode(%q, %d) = %v, ждали %v", c.bind, c.admins, got, c.want)
		}
	}
}
