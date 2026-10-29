// SPDX-License-Identifier: GPL-3.0-only

//go:build windows

package main

import (
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

// Проверка прав на TUN согласована с токеном процесса, а причина отказа
// называет администратора и запасной выход.
func TestTunPrivilegeCheckMatchesProcessToken(t *testing.T) {
	err := tunPrivilegeCheck()
	if elevated := windows.GetCurrentProcessToken().IsElevated(); elevated != (err == nil) {
		t.Fatalf("повышен=%v, ошибка=%v", elevated, err)
	}
	if err != nil {
		for _, want := range []string{"администратор", "системный прокси"} {
			if !strings.Contains(err.Error(), want) {
				t.Errorf("в тексте %q нет %q", err, want)
			}
		}
	}
}
