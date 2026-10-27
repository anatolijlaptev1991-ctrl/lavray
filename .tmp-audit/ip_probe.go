package main

import (
	"fmt"
	"net"
	"net/url"
)

func main() {
	for _, s := range []string{"::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "64:ff9b::7f00:1", "2002:7f00:1::", "2001::1", "198.18.0.1", "192.0.0.1", "192.0.2.1", "0.0.0.0", "255.255.255.255", "fe80::1", "::1", "fc00::1"} {
		ip := net.ParseIP(s)
		fmt.Printf("%-26s parsed=%v loop=%v priv=%v link=%v mult=%v unspec=%v\n", s, ip != nil,
			ip != nil && ip.IsLoopback(), ip != nil && ip.IsPrivate(), ip != nil && ip.IsLinkLocalUnicast(), ip != nil && ip.IsMulticast(), ip != nil && ip.IsUnspecified())
	}
	for _, raw := range []string{"http://[::ffff:127.0.0.1]:8080/x", "http://[fe80::1%25eth0]/x", "HTTP://example.com/x"} {
		u, err := url.Parse(raw)
		if err != nil { fmt.Println(raw, "ERR", err); continue }
		fmt.Printf("%-34s scheme=%q hostname=%q parse=%v\n", raw, u.Scheme, u.Hostname(), net.ParseIP(u.Hostname()))
	}
	// IsPrivateIP logic mimic for mapped 127
	ip := net.ParseIP("::ffff:127.0.0.1")
	for _, cidr := range []string{"127.0.0.0/8", "::/128"} {
		_, n, _ := net.ParseCIDR(cidr)
		fmt.Println(cidr, n.Contains(ip))
	}
}
