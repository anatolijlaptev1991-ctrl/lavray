// SPDX-License-Identifier: GPL-3.0-only

//go:build windows

package main

import (
	"errors"

	"golang.org/x/sys/windows"
)

// errTunNotElevated — понятная причина отказа TUN для клиентов, которые не
// могут показать диалог перезапуска от администратора (агенты MCP).
var errTunNotElevated = errors.New("режим TUN требует прав администратора, а ядро запущено без повышения: " +
	"перезапустите LAVRay от администратора (диалог в окне приложения) или переключите режим на системный прокси")

// tunPrivilegeCheck — TUN в Windows создаётся только повышенным процессом.
// Ядро наследует повышение у оболочки, поэтому проверяется токен самого ядра.
func tunPrivilegeCheck() error {
	if windows.GetCurrentProcessToken().IsElevated() {
		return nil
	}
	return errTunNotElevated
}
