// SPDX-License-Identifier: GPL-3.0-only

// web_test.go — панель: вход/брутфорс/CSRF/Origin/bind/сессии (FR-UI-278).
package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeAuth struct{ pass string }

func (f fakeAuth) Verify(p string) bool { return p == f.pass }

func newTestPanel() *Panel {
	return NewPanel(fakeAuth{pass: "secret-пароль"})
}

func loginOK(t *testing.T, p *Panel, password string) (*http.Cookie, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/web/login", strings.NewReader("password="+password))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.RemoteAddr = "10.0.0.1:1234"
	rec := httptest.NewRecorder()
	p.Middleware(http.NotFoundHandler()).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("login %q: code=%d body=%s", password, rec.Code, rec.Body.String())
	}
	var cookie *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookie {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatal("cookie сессии не выдана")
	}
	csrf := strings.TrimSuffix(strings.TrimPrefix(rec.Body.String(), `{"csrf":"`), `"}`)
	return cookie, csrf
}

func TestLoginSetsCookies(t *testing.T) {
	p := newTestPanel()
	cookie, csrf := loginOK(t, p, "secret-пароль")
	if cookie.HttpOnly != true || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("cookie-флаги: %+v", cookie)
	}
	if len(csrf) < 32 {
		t.Fatalf("csrf короткий: %q", csrf)
	}
}

func TestBadPasswordAndBackoff(t *testing.T) {
	p := newTestPanel()
	do := func() int {
		req := httptest.NewRequest(http.MethodPost, "/api/web/login", strings.NewReader("password=wrong"))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.RemoteAddr = "10.0.0.9:1"
		rec := httptest.NewRecorder()
		p.Middleware(http.NotFoundHandler()).ServeHTTP(rec, req)
		return rec.Code
	}
	for i := 0; i < 5; i++ {
		if code := do(); code != http.StatusUnauthorized {
			t.Fatalf("попытка %d: code=%d", i, code)
		}
	}
	if code := do(); code != http.StatusTooManyRequests {
		t.Fatalf("6-я попытка: code=%d (ждём 429)", code)
	}
	// Верный пароль тоже блокируется в период бэкоффа.
	req := httptest.NewRequest(http.MethodPost, "/api/web/login", strings.NewReader("password=secret-пароль"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.RemoteAddr = "10.0.0.9:1"
	rec := httptest.NewRecorder()
	p.Middleware(http.NotFoundHandler()).ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("верный пароль в бэкоффе: code=%d", rec.Code)
	}
	// Другой источник не задет (per-source).
	loginOK(t, p, "secret-пароль")
}

func TestApiRequiresSession(t *testing.T) {
	p := newTestPanel()
	req := httptest.NewRequest(http.MethodGet, "/lavray.v1.CoreService/GetStatus", nil)
	rec := httptest.NewRecorder()
	p.Middleware(http.NotFoundHandler()).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("без сессии: code=%d", rec.Code)
	}
}

func TestMutationRequiresCSRFAndOrigin(t *testing.T) {
	p := newTestPanel()
	cookie, csrf := loginOK(t, p, "secret-пароль")
	hit := func(method, csrfHdr, origin string) int {
		req := httptest.NewRequest(method, "/lavray.v1.ProfileService/DeleteProfile", strings.NewReader("{}"))
		req.AddCookie(cookie)
		if csrfHdr != "" {
			req.Header.Set(csrfHeader, csrfHdr)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		rec := httptest.NewRecorder()
		p.Middleware(http.NotFoundHandler()).ServeHTTP(rec, req)
		return rec.Code
	}
	if c := hit(http.MethodPost, "", ""); c != http.StatusForbidden {
		t.Fatalf("без CSRF: %d", c)
	}
	if c := hit(http.MethodPost, "wrong", ""); c != http.StatusForbidden {
		t.Fatalf("чужой CSRF: %d", c)
	}
	if c := hit(http.MethodPost, csrf, "https://evil.example"); c != http.StatusForbidden {
		t.Fatalf("чужой Origin: %d", c)
	}
	if c := hit(http.MethodPost, csrf, ""); c == http.StatusForbidden {
		t.Fatalf("валидный CSRF заблокирован: %d", c)
	}
	// GET не требует CSRF.
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	p.Middleware(http.NotFoundHandler()).ServeHTTP(rec, req)
	if rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden {
		t.Fatalf("GET с сессией: %d", rec.Code)
	}
}

func TestLogoutKillsSession(t *testing.T) {
	p := newTestPanel()
	cookie, _ := loginOK(t, p, "secret-пароль")
	req := httptest.NewRequest(http.MethodPost, "/api/web/logout", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	p.Middleware(http.NotFoundHandler()).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatal("logout")
	}
	req2 := httptest.NewRequest(http.MethodGet, "/x", nil)
	req2.AddCookie(cookie)
	rec2 := httptest.NewRecorder()
	p.Middleware(http.NotFoundHandler()).ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusUnauthorized {
		t.Fatalf("после logout: %d", rec2.Code)
	}
}

func TestCheckBindPolicy(t *testing.T) {
	if err := CheckBind("127.0.0.1:8080", false); err != nil {
		t.Fatalf("loopback: %v", err)
	}
	if err := CheckBind("0.0.0.0:8080", false); err == nil {
		t.Fatal("0.0.0.0 без allow_remote прошёл")
	}
	if err := CheckBind("0.0.0.0:8080", true); err != nil {
		t.Fatalf("0.0.0.0 с allow_remote: %v", err)
	}
	if err := CheckBind("192.168.1.1:8080", false); err == nil {
		t.Fatal("lan-ip без allow_remote прошёл")
	}
	if err := CheckBind("не-адрес", true); err == nil {
		t.Fatal("мусор прошёл")
	}
}

func TestSessionExpiry(t *testing.T) {
	p := newTestPanel()
	cookie, _ := loginOK(t, p, "secret-пароль")
	p.mu.Lock()
	s := p.sessions[cookie.Value]
	s.expires = time.Now().Add(-time.Second)
	p.sessions[cookie.Value] = s
	p.mu.Unlock()
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	p.Middleware(http.NotFoundHandler()).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("истёкшая сессия: %d", rec.Code)
	}
}

func TestPBKDF2RoundTrip(t *testing.T) {
	h := PBKDF2Hash("пароль-№7", 100000) // быстрые итерации для теста
	if !PBKDF2Verify("пароль-№7", h) {
		t.Fatal("верный пароль отвергнут")
	}
	if PBKDF2Verify("другой", h) {
		t.Fatal("чужой пароль принят")
	}
	if PBKDF2Verify("x", "pbkdf2$99999$AAAA$BBBB") {
		t.Fatal("слабые итерации приняты")
	}
	if PBKDF2Verify("x", "мусор") {
		t.Fatal("битый формат принят")
	}
}

func TestHealthzOpen(t *testing.T) {
	p := newTestPanel()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	p.Middleware(http.NotFoundHandler()).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("healthz: %d", rec.Code)
	}
}
