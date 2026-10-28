package api

import (
	"context"
	"net"
	"net/http"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect"

	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
)

const (
	directIP = "203.0.113.7"  // что видит сервис IP при прямом запросе
	tunnelIP = "198.51.100.9" // что видит сервис IP при запросе через туннель
)

// ipFixture: «прямой» канал отвечает directIP, mixed-in (fakeProxy) — tunnelIP.
func ipFixture(t *testing.T) (*svcFixture, *fakeProxy, *[]string) {
	t.Helper()
	var direct []string
	f := newSvcFixture(t, &http.Client{Transport: textRT(directIP, &direct)})
	f.srv.ipURL = "http://ip.test/"
	f.srv.dial = func(context.Context, string, string) (net.Conn, error) { return nil, net.ErrClosed }
	return f, startFakeProxy(t, tunnelIP), &direct
}

func publicIP(t *testing.T, s *Server, via lavrayv1.GetPublicIpRequest_Via) (string, error) {
	t.Helper()
	r, err := s.GetPublicIp(context.Background(), connect.NewRequest(&lavrayv1.GetPublicIpRequest{Via: via}))
	if err != nil {
		return "", err
	}
	return r.Msg.GetIp(), nil
}

// T-16 (A1-12, B2-09): via выбирает путь запроса.
func TestGetPublicIpHonorsVia(t *testing.T) {
	f, proxy, direct := ipFixture(t)
	s := f.srv

	// Туннель не поднят: «через туннель» — отказ, «по умолчанию» — напрямую.
	if _, err := publicIP(t, s, lavrayv1.GetPublicIpRequest_VIA_THROUGH_TUNNEL); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("THROUGH_TUNNEL без туннеля: ожидался FAILED_PRECONDITION, получено %v", err)
	}
	if ip, err := publicIP(t, s, lavrayv1.GetPublicIpRequest_VIA_UNSPECIFIED); err != nil || ip != directIP {
		t.Fatalf("UNSPECIFIED без туннеля = %q, %v; ожидался прямой %s", ip, err, directIP)
	}

	f.bringUpTunnel(t, proxy.port(), "system_proxy")
	for _, c := range []struct {
		via  lavrayv1.GetPublicIpRequest_Via
		want string
	}{
		{lavrayv1.GetPublicIpRequest_VIA_DIRECT, directIP},
		{lavrayv1.GetPublicIpRequest_VIA_THROUGH_TUNNEL, tunnelIP},
		{lavrayv1.GetPublicIpRequest_VIA_UNSPECIFIED, tunnelIP},
	} {
		if ip, err := publicIP(t, s, c.via); err != nil || ip != c.want {
			t.Errorf("via=%v: %q, %v; ожидалось %s", c.via, ip, err, c.want)
		}
	}
	if got := proxy.requests(); len(got) != 2 || !strings.HasPrefix(got[0], "GET http://ip.test/") {
		t.Errorf("через mixed-in должны пройти ровно 2 запроса, получено %v", got)
	}
	if len(*direct) != 2 { // один до подъёма туннеля, один — DIRECT
		t.Errorf("прямых запросов %d, ожидалось 2: %v", len(*direct), *direct)
	}
}

// В режиме TUN «прямой» замер из ядра недостоверен — отказ вместо ложного IP.
func TestGetPublicIpDirectRefusedInTUN(t *testing.T) {
	f, proxy, _ := ipFixture(t)
	f.bringUpTunnel(t, proxy.port(), "tun")
	if _, err := publicIP(t, f.srv, lavrayv1.GetPublicIpRequest_VIA_DIRECT); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("DIRECT в TUN: ожидался FAILED_PRECONDITION, получено %v", err)
	}
}

// Ответ сервиса IP проверяется: статус и формат (раньше любой HTML становился «IP»).
func TestGetPublicIpRejectsBadAnswers(t *testing.T) {
	var hits []string
	f := newSvcFixture(t, &http.Client{Transport: textRT("<html>blocked</html>", &hits)})
	f.srv.ipURL = "http://ip.test/"
	if ip, err := publicIP(t, f.srv, lavrayv1.GetPublicIpRequest_VIA_DIRECT); err == nil || connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("HTML вместо адреса принят как IP %q (err=%v)", ip, err)
	}
}

func leaks(t *testing.T, s *Server) *lavrayv1.LeakReport {
	t.Helper()
	r, err := s.CheckLeaks(context.Background(), connect.NewRequest(&lavrayv1.Empty{}))
	if err != nil {
		t.Fatal(err)
	}
	return r.Msg
}

// T-16 (B1-17): CheckLeaks называет то, что не измерено; измеренное — настоящее.
func TestCheckLeaksReportsOnlyWhatWasMeasured(t *testing.T) {
	f, proxy, _ := ipFixture(t)
	s := f.srv

	// 1) Туннеля нет: тоннельный IP и IPv6 — «не проверено», прямой IP измерен.
	r := leaks(t, s)
	if r.GetDirectIp() != directIP || r.TunnelIp != nil || r.TunnelActive {
		t.Errorf("без туннеля: %+v", r)
	}
	for _, k := range []string{"tunnel_ip", "ipv6", "dns"} {
		if !slices.Contains(r.Unchecked, k) {
			t.Errorf("без туннеля %q обязан быть в unchecked: %v", k, r.Unchecked)
		}
	}

	// 2) Туннель поднят (системный прокси): оба IP различны, IPv6 измерен (нет).
	f.bringUpTunnel(t, proxy.port(), "system_proxy")
	r = leaks(t, s)
	if r.GetDirectIp() != directIP || r.GetTunnelIp() != tunnelIP || !r.TunnelActive {
		t.Errorf("с туннелем: %+v", r)
	}
	if !slices.Equal(r.Unchecked, []string{"dns"}) || r.Ipv6DirectAvailable {
		t.Errorf("с туннелем не измерен только DNS, IPv6 прямого нет: unchecked=%v ipv6=%v", r.Unchecked, r.Ipv6DirectAvailable)
	}

	// 3) Прямой IPv6 есть (зонд соединился) — это риск утечки.
	s.dial = func(context.Context, string, string) (net.Conn, error) {
		c, _ := net.Pipe()
		return c, nil
	}
	if r = leaks(t, s); !r.Ipv6DirectAvailable {
		t.Errorf("IPv6 доступен напрямую, а отчёт говорит «нет»")
	}
}

func TestCheckLeaksInTUNSkipsDirectMeasurements(t *testing.T) {
	f, proxy, direct := ipFixture(t)
	f.bringUpTunnel(t, proxy.port(), "tun")
	r := leaks(t, f.srv)
	if r.DirectIp != nil || len(*direct) != 0 {
		t.Errorf("в TUN прямой замер не выполняется: direct_ip=%v запросов=%v", r.DirectIp, *direct)
	}
	for _, k := range []string{"direct_ip", "ipv6", "dns"} {
		if !slices.Contains(r.Unchecked, k) {
			t.Errorf("в TUN %q обязан быть в unchecked: %v", k, r.Unchecked)
		}
	}
	if r.GetTunnelIp() != tunnelIP {
		t.Errorf("tunnel_ip = %q", r.GetTunnelIp())
	}
}

// T-16 (A1-12): подписка идёт через туннель, когда он поднят и sub.use_proxy=true.
func TestSubscriptionClientFollowsUseProxy(t *testing.T) {
	var direct []string
	f := newSvcFixture(t, &http.Client{Transport: textRT("vless://x", &direct)})
	proxy := startFakeProxy(t, "vless://via-tunnel")
	s := f.srv
	// Публичный IP-литерал: URL-охранник пропускает его без DNS; по сети запрос
	// не уходит — его принимает fakeProxy либо прямой RoundTripper.
	g := &model.Group{SubscriptionURL: "http://93.184.216.34/sub"}
	fetch := func() string {
		resp, err := s.subscriberFor().Fetch(context.Background(), g)
		if err != nil {
			t.Fatal(err)
		}
		return string(resp.Body)
	}

	if body := fetch(); body != "vless://x" || len(proxy.requests()) != 0 {
		t.Fatalf("туннеля нет: ожидался прямой запрос, тело=%q, прокси=%v", body, proxy.requests())
	}
	f.bringUpTunnel(t, proxy.port(), "system_proxy")
	if body := fetch(); body != "vless://via-tunnel" || len(proxy.requests()) != 1 {
		t.Fatalf("туннель поднят, use_proxy по умолчанию true: тело=%q, прокси=%v", body, proxy.requests())
	}
	if err := s.st.SetSetting("sub.use_proxy", "false"); err != nil {
		t.Fatal(err)
	}
	if body := fetch(); body != "vless://x" || len(proxy.requests()) != 1 {
		t.Fatalf("use_proxy=false: ожидался прямой запрос, тело=%q, прокси=%v", body, proxy.requests())
	}
}
