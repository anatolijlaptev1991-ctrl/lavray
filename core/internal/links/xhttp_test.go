// SPDX-License-Identifier: GPL-3.0-only

package links

import (
	"strings"
	"testing"
)

// Ссылка XHTTP разбирается, а при экспорте тип транспорта и путь не теряются
// (раньше импорт отвергал такую ссылку целиком).
func TestXHTTPLinkRoundTrip(t *testing.T) {
	const link = "vless://11111111-1111-1111-1111-111111111111@xh.example.org:443" +
		"?type=xhttp&security=tls&sni=xh.example.org&path=%2Fsplit&host=cdn.example.org&mode=auto#xh"
	p, err := ParseLink(link)
	if err != nil {
		t.Fatal(err)
	}
	if p.Stream.Network != "xhttp" || p.Stream.Path != "/split" || p.Stream.Host != "cdn.example.org" {
		t.Fatalf("stream = %+v", p.Stream)
	}
	out, err := BuildLink(p)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "type=xhttp") || !strings.Contains(out, "path=%2Fsplit") {
		t.Errorf("экспорт потерял транспорт: %s", out)
	}
	back, err := ParseLink(out)
	if err != nil {
		t.Fatal(err)
	}
	if back.Stream.Network != "xhttp" {
		t.Errorf("повторный разбор: %q", back.Stream.Network)
	}
}

// vmess:// в формате JSON с net=xhttp тоже разбирается.
func TestXHTTPVMessJSON(t *testing.T) {
	js := `{"v":"2","ps":"xh","add":"xh.example.org","port":"443","id":"11111111-1111-1111-1111-111111111111","aid":"0","net":"xhttp","path":"/p","tls":"tls"}`
	p, err := ParseLink("vmess://" + b64std(js))
	if err != nil {
		t.Fatal(err)
	}
	if p.Stream.Network != "xhttp" {
		t.Errorf("network = %q", p.Stream.Network)
	}
}
