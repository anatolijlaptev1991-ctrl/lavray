// SPDX-License-Identifier: GPL-3.0-only

//go:build windows

package nekoimport

import "testing"

// listProcesses только читает список процессов: ошибок нет, в ответе лишь
// процессы NekoBox/nekoray. Есть ли они в системе, тест не требует и не меняет.
func TestListProcessesReadOnlySmoke(t *testing.T) {
	list, err := listProcesses()
	if err != nil {
		t.Fatalf("listProcesses: %v", err)
	}
	for _, p := range list {
		if !IsNekoProcess(p.Name) {
			t.Errorf("в ответе посторонний процесс %q", p.Name)
		}
	}
}
