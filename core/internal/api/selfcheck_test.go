package api

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
)

type (
	kind   = lavrayv1.RunSelfCheckRequest_CheckKind
	status = lavrayv1.SelfCheckResult_Status
)

const (
	kCore   = lavrayv1.RunSelfCheckRequest_CHECK_KIND_CORE_ALIVE
	kServer = lavrayv1.RunSelfCheckRequest_CHECK_KIND_SERVER_REACHABLE
	kDNS    = lavrayv1.RunSelfCheckRequest_CHECK_KIND_DNS_RESOLVES
	kProxy  = lavrayv1.RunSelfCheckRequest_CHECK_KIND_PROXY_ACTIVE
	kClock  = lavrayv1.RunSelfCheckRequest_CHECK_KIND_CLOCK_SKEW
	kSub    = lavrayv1.RunSelfCheckRequest_CHECK_KIND_SUBSCRIPTION_OK
	kPort   = lavrayv1.RunSelfCheckRequest_CHECK_KIND_PORT_FREE
	kIPv6   = lavrayv1.RunSelfCheckRequest_CHECK_KIND_IPV6

	sOK   = lavrayv1.SelfCheckResult_STATUS_OK
	sWarn = lavrayv1.SelfCheckResult_STATUS_WARN
	sFail = lavrayv1.SelfCheckResult_STATUS_FAIL
	sSkip = lavrayv1.SelfCheckResult_STATUS_UNSPECIFIED // «не проверено»
)

// dateRT отвечает 204 с заголовком Date = now+skew и запоминает адреса запросов.
func dateRT(skew time.Duration, hits *[]string) rtFunc {
	return func(r *http.Request) (*http.Response, error) {
		*hits = append(*hits, r.URL.String())
		h := http.Header{"Date": {time.Now().Add(skew).UTC().Format(http.TimeFormat)}}
		return &http.Response{StatusCode: 204, Header: h, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	}
}

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

func runChecks(t *testing.T, s *Server, kinds ...kind) map[kind]*lavrayv1.SelfCheckResult {
	t.Helper()
	r, err := s.RunSelfCheck(context.Background(), connect.NewRequest(&lavrayv1.RunSelfCheckRequest{Kinds: kinds}))
	if err != nil {
		t.Fatal(err)
	}
	out := map[kind]*lavrayv1.SelfCheckResult{}
	for _, x := range r.Msg.Results {
		out[x.Kind] = x
	}
	return out
}

func want(t *testing.T, got map[kind]*lavrayv1.SelfCheckResult, k kind, st status, detail string) {
	t.Helper()
	r := got[k]
	if r == nil || r.Status != st || !strings.Contains(r.GetDetail(), detail) {
		t.Errorf("%v: получено %v, ожидалось статус %v с %q", k, r, st, detail)
	}
}

// T-32 (B2-08): без подключения — все 8 проверок, непроверенное названо, а не «ок».
func TestRunSelfCheckWithoutConnection(t *testing.T) {
	var hits []string
	f := newSvcFixture(t, &http.Client{Transport: dateRT(0, &hits)})
	s := f.srv
	if err := setSetting(t, s, "inbound.port", intSetting(int64(freePort(t)))); err != nil {
		t.Fatal(err)
	}
	if err := setSetting(t, s, "test.url", strSetting("http://time.test/generate_204")); err != nil {
		t.Fatal(err)
	}

	got := runChecks(t, s)
	if len(got) != 8 {
		t.Fatalf("ожидалось 8 проверок, получено %d: %v", len(got), got)
	}
	want(t, got, kCore, sOK, "")
	want(t, got, kServer, sSkip, "no_connection")
	want(t, got, kDNS, sSkip, "no_connection")
	want(t, got, kProxy, sFail, "no_connection")
	want(t, got, kClock, sOK, "s")
	want(t, got, kSub, sSkip, "no_subscription")
	want(t, got, kPort, sOK, "127.0.0.1:")
	want(t, got, kIPv6, sSkip, "no_connection")
	if len(hits) != 1 || hits[0] != "http://time.test/generate_204" {
		t.Errorf("единственный сетевой запрос — время по test.url, получено %v", hits)
	}
	// Фильтр kinds.
	if only := runChecks(t, s, kPort); len(only) != 1 || only[kPort] == nil {
		t.Errorf("kinds=[PORT_FREE] вернул %v", only)
	}
}

// Подключено: сервер, DNS, прокси, порт и IPv6 проверяются по-настоящему.
func TestRunSelfCheckConnected(t *testing.T) {
	f := newSvcFixture(t, nil)
	s := f.srv
	ln, err := net.Listen("tcp", "127.0.0.1:0") // «сервер профиля»
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()
	// mixed-in — фальшивый прокси: домен dns.test «не резолвится» (502), остальное проходит.
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Host, "dns.test") {
			w.WriteHeader(http.StatusBadGateway)
		}
	}))
	defer proxy.Close()
	p := f.trojan(t)
	p.Address, p.Port = "127.0.0.1", ln.Addr().(*net.TCPAddr).Port
	if err := s.st.UpdateProfile(p); err != nil {
		t.Fatal(err)
	}
	s.ipProbeURL = "http://198.51.100.1/"
	s.dial = func(ctx context.Context, n, a string) (net.Conn, error) {
		if n == "tcp6" {
			return nil, errors.New("нет IPv6")
		}
		return (&net.Dialer{}).DialContext(ctx, n, a)
	}
	for k, v := range map[string]*lavrayv1.SettingValue{
		"inbound.port": intSetting(int64(proxy.Listener.Addr().(*net.TCPAddr).Port)),
		"test.url":     strSetting("http://dns.ok.test/"),
	} {
		if err := setSetting(t, s, k, v); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Connect(context.Background(), connect.NewRequest(&lavrayv1.ConnectRequest{ProfileId: &p.ID})); err != nil {
		t.Fatal(err)
	}

	got := runChecks(t, s)
	want(t, got, kServer, sOK, "ms")
	want(t, got, kDNS, sOK, "")
	want(t, got, kProxy, sOK, "127.0.0.1:")
	want(t, got, kPort, sOK, "127.0.0.1:")
	want(t, got, kIPv6, sOK, "")

	// DNS в туннеле сломан (прокси отвечает 502 на домен), а трафик к адресу идёт.
	if err := setSetting(t, s, "test.url", strSetting("http://dns.test/")); err != nil {
		t.Fatal(err)
	}
	got = runChecks(t, s, kDNS, kProxy)
	want(t, got, kDNS, sFail, "502")
	if r := got[kDNS]; r != nil && r.FixCode != "open_dns" {
		t.Errorf("fix_code DNS = %q", r.FixCode)
	}
	want(t, got, kProxy, sOK, "")

	// Прямой IPv6 есть — это предупреждение.
	s.dial = func(context.Context, string, string) (net.Conn, error) { c, _ := net.Pipe(); return c, nil }
	want(t, runChecks(t, s, kIPv6), kIPv6, sWarn, "v6_direct")
}

func TestSelfCheckClock(t *testing.T) {
	for _, c := range []struct {
		skew time.Duration
		want status
	}{{0, sOK}, {2 * time.Second, sOK}, {40 * time.Second, sWarn}, {-3 * time.Minute, sFail}} {
		var hits []string
		f := newSvcFixture(t, &http.Client{Transport: dateRT(c.skew, &hits)})
		want(t, runChecks(t, f.srv, kClock), kClock, c.want, "")
	}
	// Сервер времени недоступен: «не проверено», а не «часы неверны».
	f := newSvcFixture(t, &http.Client{Transport: rtFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("blocked") })})
	want(t, runChecks(t, f.srv, kClock), kClock, sSkip, "time_unreachable")
}

func TestSelfCheckPortBusy(t *testing.T) {
	f := newSvcFixture(t, nil)
	busy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()
	if err := setSetting(t, f.srv, "inbound.port", intSetting(int64(busy.Addr().(*net.TCPAddr).Port))); err != nil {
		t.Fatal(err)
	}
	got := runChecks(t, f.srv, kPort)
	want(t, got, kPort, sFail, "")
	if r := got[kPort]; r != nil && r.FixCode != "change_port" {
		t.Errorf("fix_code = %q, ожидался change_port", r.FixCode)
	}
}

func TestSelfCheckSubscription(t *testing.T) {
	f := newSvcFixture(t, nil)
	now := time.Now()
	mk := func(name string, expire time.Time) {
		ms := expire.UnixMilli()
		g := &model.Group{Name: name, Kind: model.GroupSubscription, SubscriptionURL: "https://sub.example/" + name,
			SubscriptionInfo: &model.SubscriptionInfo{ExpireMs: &ms}}
		if err := f.srv.st.CreateGroup(g); err != nil {
			t.Fatal(err)
		}
	}
	mk("fresh", now.Add(30*24*time.Hour))
	want(t, runChecks(t, f.srv, kSub), kSub, sOK, "fresh")
	mk("soon", now.Add(24*time.Hour))
	want(t, runChecks(t, f.srv, kSub), kSub, sWarn, "soon")
	mk("old", now.Add(-time.Hour))
	got := runChecks(t, f.srv, kSub)
	want(t, got, kSub, sFail, "old")
	if r := got[kSub]; r != nil && r.FixCode != "open_subscriptions" {
		t.Errorf("fix_code = %q", r.FixCode)
	}
}
