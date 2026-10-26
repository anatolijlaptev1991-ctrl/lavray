// Package web — веб-панель LAVRay (W7, FR-UI-278): вход по паролю
// (PBKDF2-HMAC-SHA256, golang.org/x/crypto/argon2 недоступен локально —
// Go-прокси; при доступности зависимости заменяем на argon2id без смены
// формата хранилища: pbkdf2$<it>$<salt>$<hash> | argon2id$…), cookie-сессии
// (HttpOnly; SameSite=Strict), CSRF-токен на мутациях, Origin-проверка,
// backoff на неверный пароль per-источник, bind 127.0.0.1 по умолчанию;
// 0.0.0.0 только при web.allow_remote (OpenWrt-панель).
package web

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"hash"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Config — настройки панели (ключи settings web.*).
type Config struct {
	Bind        string // "127.0.0.1:0" по умолчанию
	AllowRemote bool   // разрешает 0.0.0.0/[::]
}

// Verifier — проверка пароля (реализация — api/webauth; тесты — мок).
type Verifier interface {
	Verify(password string) bool
}

// Panel — HTTP-обвязка: login/logout/healthz + защита API-мутаций.
type Panel struct {
	verifier Verifier

	mu       sync.Mutex
	sessions map[string]session // token → session
	attempts map[string]*backoff
}

type session struct {
	csrf    string
	expires time.Time
}

type backoff struct {
	fails       int
	blockedTill time.Time
}

const (
	sessionTTL    = 12 * time.Hour
	maxFails      = 5
	blockStep     = 2 * time.Second // 5 fails → 2s, +2s за каждую следующую
	blockMax      = 2 * time.Minute
	csrfHeader    = "X-LAVRay-CSRF"
	sessionCookie = "lavray_session"
)

func NewPanel(v Verifier) *Panel {
	return &Panel{verifier: v, sessions: map[string]session{}, attempts: map[string]*backoff{}}
}

// CheckBind — политика listen-адреса: loopback всегда; 0.0.0.0/[::] —
// только при AllowRemote (FR-UI-279-класс: случайный открытый доступ
// исключён на старте).
func CheckBind(addr string, allowRemote bool) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("web.bind %q: %v", addr, err)
	}
	if host == "" {
		host = "0.0.0.0"
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return fmt.Errorf("web.bind: %q не IP-адрес", host)
	}
	if !ip.IsLoopback() && !allowRemote {
		return fmt.Errorf("web.bind %s открывает панель наружу: установите web.allow_remote=true (осознанно, роутер)", host)
	}
	return nil
}

// Middleware — обёртка API-хендлера: без сессии 401; мутации требуют CSRF
// и совпадающий Origin; login/healthz открытые.
func (p *Panel) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/healthz" {
			w.WriteHeader(http.StatusOK)
			return
		}
		if path == "/api/web/login" && r.Method == http.MethodPost {
			p.handleLogin(w, r)
			return
		}
		if path == "/api/web/logout" {
			p.handleLogout(w, r)
			return
		}
		tok, err := r.Cookie(sessionCookie)
		if err != nil || !p.validSession(tok.Value) {
			http.Error(w, `{"code":"unauthenticated"}`, http.StatusUnauthorized)
			return
		}
		// CSRF: все не-GET требуют заголовок-токен сессии.
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			csrf := r.Header.Get(csrfHeader)
			if csrf == "" || subtle.ConstantTimeCompare([]byte(csrf), []byte(p.sessionCSRF(tok.Value))) != 1 {
				http.Error(w, `{"code":"csrf"}`, http.StatusForbidden)
				return
			}
			// Origin (если браузер прислал) должен совпадать с Host
			// (SameSite=Strict — второй барьер).
			if o := r.Header.Get("Origin"); o != "" && !sameOrigin(o, r.Host) {
				http.Error(w, `{"code":"origin"}`, http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func sameOrigin(origin, host string) bool {
	h := origin
	if i := strings.Index(h, "://"); i >= 0 {
		h = h[i+3:]
	}
	return strings.EqualFold(h, host)
}

func (p *Panel) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if ip == "" {
		ip = r.RemoteAddr
	}
	p.mu.Lock()
	at := p.attempts[ip]
	if at == nil {
		at = &backoff{}
		p.attempts[ip] = at
	}
	blocked := time.Now().Before(at.blockedTill)
	p.mu.Unlock()
	if blocked {
		http.Error(w, `{"code":"too_many_attempts"}`, http.StatusTooManyRequests)
		return
	}
	password := r.PostFormValue("password")
	if password == "" {
		password = r.Header.Get("X-LAVRay-Password")
	}
	if password == "" || !p.verifier.Verify(password) {
		p.mu.Lock()
		at.fails++
		if at.fails >= maxFails {
			d := time.Duration(at.fails-maxFails+1) * blockStep
			if d > blockMax {
				d = blockMax
			}
			at.blockedTill = time.Now().Add(d)
			at.fails = 0
		}
		p.mu.Unlock()
		http.Error(w, `{"code":"bad_credentials"}`, http.StatusUnauthorized)
		return
	}
	p.mu.Lock()
	delete(p.attempts, ip)
	tok, csrf := newToken(), newToken()
	p.sessions[tok] = session{csrf: csrf, expires: time.Now().Add(sessionTTL)}
	p.mu.Unlock()
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: tok, Path: "/",
		HttpOnly: true, SameSite: http.SameSiteStrictMode,
		MaxAge: int(sessionTTL.Seconds()),
	})
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"csrf":%q}`, csrf)
}

func (p *Panel) handleLogout(w http.ResponseWriter, r *http.Request) {
	if tok, err := r.Cookie(sessionCookie); err == nil {
		p.mu.Lock()
		delete(p.sessions, tok.Value)
		p.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1})
	w.WriteHeader(http.StatusOK)
}

func (p *Panel) validSession(tok string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	s, ok := p.sessions[tok]
	if !ok || time.Now().After(s.expires) {
		if ok {
			delete(p.sessions, tok)
		}
		return false
	}
	return true
}

func (p *Panel) sessionCSRF(tok string) string {
	p.mu.Lock()
	defer p.mu.Unlock()
	if s, ok := p.sessions[tok]; ok {
		return s.csrf
	}
	return ""
}

func newToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// Serve — запуск панели; порт 0 → фактический адрес возвращается.
func (p *Panel) Serve(ctx context.Context, cfg Config) (string, func(), error) {
	bind := cfg.Bind
	if bind == "" {
		bind = "127.0.0.1:0"
	}
	if err := CheckBind(bind, cfg.AllowRemote); err != nil {
		return "", nil, err
	}
	ln, err := net.Listen("tcp", bind)
	if err != nil {
		return "", nil, err
	}
	srv := &http.Server{Handler: p.Middleware(http.NotFoundHandler())}
	go func() { _ = srv.Serve(ln) }()
	stop := func() {
		shCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(shCtx)
	}
	return ln.Addr().String(), stop, nil
}

// PBKDF2Hash — формат хранилища пароля: pbkdf2$<it>$<salt-b64>$<hash-b64>.
func PBKDF2Hash(password string, iterations int) string {
	if iterations <= 0 {
		iterations = 600000
	}
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	return "pbkdf2$" + strconv.Itoa(iterations) + "$" +
		base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(pbkdf2Key(password, salt, iterations))
}

// PBKDF2Verify — постоянное время сравнения.
func PBKDF2Verify(password, stored string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2" {
		return false
	}
	it, err := strconv.Atoi(parts[1])
	if err != nil || it < 100000 {
		return false // слабые параметры не принимаем
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	got := pbkdf2Key(password, salt, it)
	return subtle.ConstantTimeCompare(got, want) == 1
}

// newHMAC — stdlib hmac.New(sha256.New, key).
func newHMAC(key []byte) hash.Hash { return hmac.New(sha256.New, key) }

// pbkdf2Key — чтобы не тянуть golang.org/x/crypto (недоступен локально):
// PBKDF2-HMAC-SHA256 поверх stdlib (RFC 8018). x/crypto/pbkdf2 — капля-замена
// при появлении зависимости в go.sum.
func pbkdf2Key(password string, salt []byte, iterations int) []byte {
	return pbkdf2SHA256([]byte(password), salt, iterations, 32)
}

func pbkdf2SHA256(password, salt []byte, iterations, keyLen int) []byte {
	hmacSha256 := func(key, data []byte) []byte {
		m := newHMAC(key)
		m.Write(data)
		return m.Sum(nil)
	}
	block := make([]byte, 4)
	out := make([]byte, 0, keyLen)
	for i := 1; len(out) < keyLen; i++ {
		block[0] = byte(i >> 24)
		block[1] = byte(i >> 16)
		block[2] = byte(i >> 8)
		block[3] = byte(i)
		u := hmacSha256(password, append(append([]byte{}, salt...), block...))
		t := append([]byte{}, u...)
		for n := 1; n < iterations; n++ {
			u = hmacSha256(password, u)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		out = append(out, t...)
	}
	return out[:keyLen]
}

// hexNonce — для тестов/отладки.
func hexNonce(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
