// SPDX-License-Identifier: GPL-3.0-only

package main

// ext_flags.go — флаги веб-режима и шлюза OpenWrt (T-76):
//
//	--web-bind <адрес:порт>   слушатель веб-панели (по умолчанию выключен)
//	--web-allow-remote        разрешить не-loopback адрес (в том числе 0.0.0.0)
//	--web-tls                 HTTPS с самоподписанным сертификатом
//	--platform openwrt        режимы шлюза (tproxy) и GatewayService
//
// Без --web-bind WebSessionService остаётся UNIMPLEMENTED, без --platform
// openwrt GatewayService отвечает INVALID_ARGUMENT.

import (
	"flag"
	"fmt"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/web"
)

// Платформы ядра.
const (
	platformDesktop = "desktop"
	platformOpenWrt = "openwrt"
)

// extFlags — значения флагов веб-режима и шлюза.
type extFlags struct {
	webBind    string
	webRemote  bool
	webTLS     bool
	platform   string
	gwPort     int
	gwIPv6     bool
	gwDNS      bool
	gwWatchdog int
	gwMark     int
	gwLAN      string
	gwSelfUser string
	nftBin     string
	stateDir   string // --gateway-state-dir: active/lavray.nft для fw4-include
	tokenFile  string // --token-file (ext_token.go)
	token      string // токен из файла после validate
}

// addExtFlags регистрирует флаги на fs.
func addExtFlags(fs *flag.FlagSet) *extFlags {
	f := &extFlags{}
	fs.StringVar(&f.webBind, "web-bind", "", "адрес веб-панели host:port (выключена, если пусто); не-loopback только с --web-allow-remote")
	fs.BoolVar(&f.webRemote, "web-allow-remote", false, "разрешить --web-bind не на loopback (роутер)")
	fs.BoolVar(&f.webTLS, "web-tls", false, "HTTPS с самоподписанным сертификатом в каталоге данных")
	fs.StringVar(&f.platform, "platform", platformDesktop, "desktop | openwrt (режимы шлюза)")
	fs.IntVar(&f.gwPort, "gateway-tproxy-port", 7893, "порт tproxy-входа шлюза (openwrt)")
	fs.BoolVar(&f.gwIPv6, "gateway-ipv6", false, "перехват IPv6 (openwrt; по умолчанию выключен)")
	fs.BoolVar(&f.gwDNS, "gateway-dns-hijack", false, "перехват порта 53 в ядро (openwrt)")
	fs.IntVar(&f.gwWatchdog, "gateway-watchdog-min", 5, "минут без связи до снятия правил (openwrt)")
	fs.IntVar(&f.gwMark, "gateway-fwmark", 1, "метка пакетов для policy routing tproxy (openwrt)")
	fs.StringVar(&f.gwLAN, "gateway-lan", "br-lan", "интерфейсы LAN через запятую (openwrt)")
	fs.StringVar(&f.gwSelfUser, "gateway-user", "lavray", "системный пользователь lavrayd для исключения из правил (openwrt)")
	fs.StringVar(&f.nftBin, "nft", "", "путь к nft (по умолчанию из PATH)")
	fs.StringVar(&f.stateDir, "gateway-state-dir", "", "каталог состояния шлюза (tmpfs): активный набор правил для include fw4 (openwrt)")
	fs.StringVar(&f.tokenFile, "token-file", "", "файл с токеном ядра (права 0600) вместо stdin: сервисный режим без оболочки")
	return f
}

func (f *extFlags) openwrt() bool { return f.platform == platformOpenWrt }

// validate проверяет сочетания флагов; пустая строка — всё в порядке.
func (f *extFlags) validate() string {
	if f.platform != platformDesktop && f.platform != platformOpenWrt {
		return fmt.Sprintf("--platform: %q, допустимо desktop или openwrt", f.platform)
	}
	if f.webBind == "" && (f.webRemote || f.webTLS) {
		return "--web-allow-remote и --web-tls требуют --web-bind"
	}
	if f.webBind != "" {
		if err := web.CheckBind(f.webBind, f.webRemote); err != nil {
			return err.Error()
		}
	}
	if f.openwrt() && (f.gwPort < 1 || f.gwPort > 65535) {
		return fmt.Sprintf("--gateway-tproxy-port: %d вне диапазона 1–65535", f.gwPort)
	}
	if f.tokenFile != "" {
		if err := f.loadToken(); err != nil {
			return err.Error()
		}
	}
	return ""
}
