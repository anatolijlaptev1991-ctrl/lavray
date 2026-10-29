package version

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

// Тест лежит в core/internal/version; корень репозитория — тремя уровнями выше.
// Если ядро собирают отдельно от репозитория (нет shell/), проверки пропускаются.
func repoFile(t *testing.T, rel string) []byte {
	t.Helper()
	path := filepath.Join("..", "..", "..", filepath.FromSlash(rel))
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		t.Skipf("%s не найден: ядро собрано вне репозитория lavray", rel)
	}
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestDefaultMatchesAppVersion(t *testing.T) {
	if !regexp.MustCompile(`^\d+\.\d+\.\d+$`).MatchString(Version) {
		t.Fatalf("Version = %q: ожидается X.Y.Z без суффиксов этапов (w3, w6)", Version)
	}

	var tauri struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(repoFile(t, "shell/tauri.conf.json"), &tauri); err != nil {
		t.Fatalf("shell/tauri.conf.json: %v", err)
	}
	if tauri.Version != Version {
		t.Errorf("shell/tauri.conf.json: version = %q, а в core/internal/version = %q; обновите оба", tauri.Version, Version)
	}

	m := regexp.MustCompile(`(?m)^version\s*=\s*"([^"]+)"`).FindSubmatch(repoFile(t, "shell/Cargo.toml"))
	if m == nil {
		t.Fatal("в shell/Cargo.toml не найдена строка version")
	}
	if string(m[1]) != Version {
		t.Errorf("shell/Cargo.toml: version = %q, а в core/internal/version = %q; обновите оба", m[1], Version)
	}
}
