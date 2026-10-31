// SPDX-License-Identifier: GPL-3.0-only

package main

// ext_gateway.go — шлюз OpenWrt (--platform openwrt): настоящий `nft -f -`
// создаётся только здесь и только на этой платформе.

import (
	"context"
	"strings"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/api"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gateway"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
)

// gatewayConfig собирает настройки шлюза из флагов.
func (f *extFlags) gatewayConfig() gateway.Config {
	var lan []string
	for _, n := range strings.Split(f.gwLAN, ",") {
		if n = strings.TrimSpace(n); n != "" {
			lan = append(lan, n)
		}
	}
	return gateway.Config{
		TProxyPort: f.gwPort, Enabled: true, IPv6: f.gwIPv6, DNSHijack: f.gwDNS,
		WatchdogMin: f.gwWatchdog, FwMark: f.gwMark, LANIfaces: lan, SelfUser: f.gwSelfUser,
	}
}

// enableGateway включает GatewayService и режимы GATEWAY_* на server.
func (f *extFlags) enableGateway(server *api.Server, st *store.Store) error {
	if !f.openwrt() {
		return nil
	}
	cfg := f.gatewayConfig()
	applier := &gateway.NftApplier{Runner: gateway.ExecRunner{Bin: f.nftBin}}
	svc, err := gateway.NewService(cfg, gateway.NewPolicyRepo(st), applier, nil)
	if err != nil {
		return err
	}
	server.EnableGateway(svc, cfg)
	return nil
}

// runGateway запускает слежение за инстансом и правилами nft.
func (f *extFlags) runGateway(ctx context.Context, server *api.Server) {
	if f.openwrt() {
		go server.RunGateway(ctx)
	}
}
