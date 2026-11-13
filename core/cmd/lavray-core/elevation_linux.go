// SPDX-License-Identifier: GPL-3.0-only

//go:build linux

package main

import "os"

// tunPrivilegeCheck — на Linux TUN создаёт процесс ядра, у которого действует
// CAP_NET_ADMIN (файловая capability от пакета) или который запущен от root
// (OpenWrt, headless-служба). Если права проверить не удалось, решает sing-box.
func tunPrivilegeCheck() error {
	if os.Geteuid() == 0 {
		return nil
	}
	status, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return nil
	}
	if hasEffectiveCap(string(status), capNetAdmin) {
		return nil
	}
	return errTunNoNetAdmin
}
