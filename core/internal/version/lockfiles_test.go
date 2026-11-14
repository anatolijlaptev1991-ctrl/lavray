// SPDX-License-Identifier: GPL-3.0-only

package version

import (
	"encoding/json"
	"regexp"
	"testing"
)

// Версию показывает и интерфейс: «Настройки → О программе» берёт её из
// ui/package.json при сборке. В 0.9.4 её забыли поднять, и тег v0.9.4 (теги
// v* неизменяемы) получил интерфейс с «v0.9.3». Тест держит все места вместе.
func TestUIAndLockfilesMatchAppVersion(t *testing.T) {
	var pkg struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(repoFile(t, "ui/package.json"), &pkg); err != nil {
		t.Fatalf("ui/package.json: %v", err)
	}
	if pkg.Version != Version {
		t.Errorf("ui/package.json: version = %q, а в core/internal/version = %q", pkg.Version, Version)
	}

	var lock struct {
		Version  string `json:"version"`
		Packages map[string]struct {
			Version string `json:"version"`
		} `json:"packages"`
	}
	if err := json.Unmarshal(repoFile(t, "ui/package-lock.json"), &lock); err != nil {
		t.Fatalf("ui/package-lock.json: %v", err)
	}
	if lock.Version != Version {
		t.Errorf("ui/package-lock.json: version = %q, а в core/internal/version = %q", lock.Version, Version)
	}
	if root := lock.Packages[""].Version; root != Version {
		t.Errorf(`ui/package-lock.json: packages[""].version = %q, а в core/internal/version = %q`, root, Version)
	}

	m := regexp.MustCompile(`(?m)^name = "lavray-shell"\r?\nversion = "([^"]+)"`).FindSubmatch(repoFile(t, "shell/Cargo.lock"))
	if m == nil {
		t.Fatal(`в shell/Cargo.lock не найден пакет lavray-shell`)
	}
	if string(m[1]) != Version {
		t.Errorf("shell/Cargo.lock: lavray-shell %q, а в core/internal/version = %q", m[1], Version)
	}
}
