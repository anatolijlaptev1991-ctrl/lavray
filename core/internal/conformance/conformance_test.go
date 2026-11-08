// SPDX-License-Identifier: GPL-3.0-only

package conformance

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"
)

var update = flag.Bool("update", false, "перегенерировать conformance/generated и conformance/manifest.json")

// repoRoot — корень репозитория (тест запускается в core/internal/conformance).
func repoRoot(t testing.TB) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "conformance")); err != nil {
		t.Fatalf("нет каталога conformance/ в %s: %v", root, err)
	}
	return root
}

// TestManifest без флага ловит дрейф: сгенерированные файлы должны совпасть с
// генератором, а manifest.json — с диском (размер и sha256 каждого файла).
// С флагом -update пересобирает generated/ и manifest.json.
func TestManifest(t *testing.T) {
	root := repoRoot(t)
	gen, err := Generate()
	if err != nil {
		t.Fatal(err)
	}
	if *update {
		if err := WriteGenerated(root, gen); err != nil {
			t.Fatal(err)
		}
		m, err := Collect(root)
		if err != nil {
			t.Fatal(err)
		}
		b, err := m.Marshal()
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, ManifestPath), b, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	for _, msg := range CheckGenerated(root, gen) {
		t.Error(msg)
	}
	raw, err := os.ReadFile(filepath.Join(root, ManifestPath))
	if err != nil {
		t.Fatal(err)
	}
	var want Manifest
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	got, err := Collect(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, msg := range Diff(want, got) {
		t.Error(msg + " (перегенерировать: go test ./internal/conformance/ -run TestManifest -update)")
	}
	if b, _ := got.Marshal(); !bytes.Equal(b, raw) && !t.Failed() {
		t.Error("manifest.json записан не в каноническом виде; выполните -update")
	}
}

// TestGenerateDeterministic: две генерации подряд дают одни и те же байты.
func TestGenerateDeterministic(t *testing.T) {
	a, err := Generate()
	if err != nil {
		t.Fatal(err)
	}
	b, err := Generate()
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != len(b) {
		t.Fatalf("число файлов %d != %d", len(a), len(b))
	}
	for name, data := range a {
		if !bytes.Equal(data, b[name]) {
			t.Errorf("недетерминированный файл %s", name)
		}
	}
}
