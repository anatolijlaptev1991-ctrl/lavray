// SPDX-License-Identifier: GPL-3.0-only

// Package conformance собирает каталог conformance/ в корне репозитория:
// нейтральные (не Go-код) тестовые данные, которые читают и Go-, и Rust-тесты
// (docs/rust-migration/PLAN.md, R0). Готовые файлы тестов пакетов ядра
// каталог не копирует, а описывает в manifest.json (путь от корня, размер,
// sha256); недостающие образцы (резервные копии LAVBK1, метаданные TUF-lite)
// генерируются здесь же детерминированно в conformance/generated/.
package conformance

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ManifestPath — путь manifest.json от корня репозитория.
const ManifestPath = "conformance/manifest.json"

// Entry — файл каталога: путь от корня репозитория («/»), размер, sha256 (hex).
type Entry struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

// Category — именованная группа файлов.
type Category struct {
	Description string  `json:"description"`
	Files       []Entry `json:"files"`
}

// Manifest — содержимое conformance/manifest.json.
type Manifest struct {
	Schema         int                 `json:"schema"`
	Description    string              `json:"description"`
	Regenerate     string              `json:"regenerate"`
	Nondeterminism []string            `json:"nondeterminism"`
	Categories     map[string]Category `json:"categories"`
}

type spec struct {
	name, desc, scan string
	keep             func(rel string) bool
}

func hasPart(part string) func(string) bool {
	return func(rel string) bool { return strings.Contains(rel, part) }
}

func specs() []spec {
	const core = "core/internal/"
	isFuzz := hasPart("/testdata/fuzz/")
	return []spec{
		{"fuzz-corpus", "Корпуса go fuzz (формат «go test fuzz v1») из testdata/fuzz/ пакетов ядра", core, isFuzz},
		{"cfgbuild-golden", "Golden-эталоны сборщика конфигурации sing-box", core + "cfgbuild/testdata/golden", nil},
		{"cfgbuild-deviations", "Заявленные отличия golden от эталонного вывода", core + "cfgbuild/testdata/deviations.yaml", nil},
		{"store-migrations", "Контрольные суммы миграций SQLite (цепочка migrate.go)", core + "store/testdata", nil},
		{"testdata-subs", "Образцы подписок парсера subs", core + "subs", func(r string) bool {
			return hasPart("/testdata/")(r) && !isFuzz(r)
		}},
		{"testdata-store-nekoimport", "Профили и группы NekoBox для импортёра store/nekoimport", core + "store", func(r string) bool {
			return hasPart("/testdata/")(r) && !isFuzz(r) && !strings.HasPrefix(r, core+"store/testdata/")
		}},
		{"generated-backup", "Образцы резервных копий LAVBK1 (генерирует этот пакет)", GeneratedDir + "/backup", nil},
		{"generated-updates", "Метаданные и подписи TUF-lite (генерирует этот пакет)", GeneratedDir + "/updates", nil},
	}
}

func hashFile(path string) (Entry, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return Entry{}, err
	}
	sum := sha256.Sum256(b)
	return Entry{Size: int64(len(b)), SHA256: hex.EncodeToString(sum[:])}, nil
}

func collect(root string, s spec) ([]Entry, error) {
	var out []Entry
	err := filepath.WalkDir(filepath.Join(root, s.scan), func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if s.keep != nil && !s.keep(rel) {
			return nil
		}
		e, err := hashFile(p)
		e.Path = rel
		out = append(out, e)
		return err
	})
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, err
}

// Collect строит manifest по файлам на диске (root — корень репозитория).
func Collect(root string) (Manifest, error) {
	m := Manifest{
		Schema:      1,
		Description: "Нейтральные данные для conformance-тестов Go и Rust; файлы не копируются, ссылки — от корня репозитория",
		Regenerate:  "cd core && CGO_ENABLED=0 GOPROXY=off go test ./internal/conformance/ -run TestManifest -update",
		Nondeterminism: []string{
			"generated-backup: тело копии содержит gzip (compress/flate); байты зависят от версии Go: проверка не перепаковывает payload, а читает закоммиченный payload.bin и запечатывает его; Rust сверяет расшифровку и payload_sha256",
		},
		Categories: map[string]Category{},
	}
	for _, s := range specs() {
		files, err := collect(root, s)
		if err != nil {
			return m, fmt.Errorf("conformance: %s: %w", s.name, err)
		}
		m.Categories[s.name] = Category{Description: s.desc, Files: files}
	}
	return m, nil
}

// Marshal — каноническая запись manifest (2 пробела, LF, перевод строки в конце).
func (m Manifest) Marshal() ([]byte, error) {
	b, err := json.MarshalIndent(m, "", "  ")
	return append(b, '\n'), err
}

// Diff перечисляет расхождения want (из manifest.json) и got (с диска).
func Diff(want, got Manifest) []string {
	idx := func(m Manifest) map[string]Entry {
		r := map[string]Entry{}
		for _, c := range m.Categories {
			for _, e := range c.Files {
				r[e.Path] = e
			}
		}
		return r
	}
	w, g := idx(want), idx(got)
	var out []string
	for p, e := range g {
		switch old, ok := w[p]; {
		case !ok:
			out = append(out, "нет в manifest: "+p)
		case old != e:
			out = append(out, fmt.Sprintf("изменён: %s (было %d байт %s, стало %d байт %s)", p, old.Size, old.SHA256, e.Size, e.SHA256))
		}
	}
	for p := range w {
		if _, ok := g[p]; !ok {
			out = append(out, "нет на диске: "+p)
		}
	}
	sort.Strings(out)
	return out
}
