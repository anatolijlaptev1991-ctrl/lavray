// SPDX-License-Identifier: GPL-3.0-only

package main

// manifest_data.go — секции presets и geo манифеста (T-75/7.5): те же поля, что
// читает клиент (updates.PresetEntry, updates.GeoSection), и тот же способ
// подписи, что у активов приложения (канонический JSON без HTML-экранирования).
// Файлы данных публикуются рядом с установщиком под путями из манифеста.

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/presets"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// dataOpts — входы секций данных.
type dataOpts struct {
	presetsDir string // каталог с <id>.json встроенных наборов
	geoZip     string // архив, собранный geo-pack
	geoDate    string // дата среза (generatedAt и часть имени файла)
	prefix     string // префикс путей на источнике («v1.2.0/»)
	outDir     string // куда копировать файлы под их именами на источнике
}

func (d dataOpts) any() bool { return d.presetsDir != "" || d.geoZip != "" }

// dataFile — файл данных: путь на источнике и содержимое.
type dataFile struct {
	rel  string
	data []byte
}

var dateRe = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}$`)

// sections строит секции presets и geo; revs — ревизии наборов для сверки с опубликованным.
func (d dataOpts) sections(now time.Time) (doc map[string]any, files []dataFile, revs map[string]int, err error) {
	doc, revs = map[string]any{}, map[string]int{}
	if d.presetsDir != "" {
		sec, fs, err := presetsSection(d.presetsDir, d.prefix, revs)
		if err != nil {
			return nil, nil, nil, err
		}
		doc["presets"], files = sec, append(files, fs...)
	}
	if d.geoZip != "" {
		date := d.geoDate
		if date == "" {
			date = now.UTC().Format("2006-01-02")
		}
		sec, f, err := geoSection(d.geoZip, d.prefix, date)
		if err != nil {
			return nil, nil, nil, err
		}
		doc["geo"], files = sec, append(files, f)
	}
	return doc, files, revs, nil
}

// presetsSection читает <id>.json встроенных наборов каталога. Не .json
// (README) и *.source.json пропускаются; любой другой .json, кроме наборов
// встроенных id, — отказ, как и файл, чьё содержимое не согласовано с именем.
func presetsSection(dir, prefix string, revs map[string]int) (map[string]any, []dataFile, error) {
	builtin, err := presets.BuiltinPresets()
	if err != nil {
		return nil, nil, err
	}
	ids := map[string]bool{}
	for _, p := range builtin {
		ids[p.ID] = true
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, nil, err
	}
	sec, files := map[string]any{}, []dataFile{}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".json") || strings.HasSuffix(name, ".source.json") {
			continue
		}
		id := strings.TrimSuffix(name, ".json")
		if !ids[id] {
			return nil, nil, fmt.Errorf("%s: %q не встроенный набор (допустимы %v)", name, id, sortedIDs(ids))
		}
		raw, rev, err := readPresetFile(filepath.Join(dir, name), id)
		if err != nil {
			return nil, nil, err
		}
		rel := path.Join(prefix, fmt.Sprintf("presets-%s-%d.json", id, rev))
		sec[id] = map[string]any{"rev": rev, "path": rel, "sha256": sha256Hex(raw)}
		files, revs[id] = append(files, dataFile{rel, raw}), rev
	}
	if len(sec) == 0 {
		return nil, nil, fmt.Errorf("в %s нет файлов <id>.json встроенных наборов", dir)
	}
	return sec, files, nil
}

func sortedIDs(ids map[string]bool) []string {
	out := make([]string, 0, len(ids))
	for id := range ids {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

// readPresetFile читает набор и проверяет его так же, как клиент: схема и
// Validate, id файла = id набора, builtin=true, размер в пределах.
func readPresetFile(p, id string) ([]byte, int, error) {
	raw, err := os.ReadFile(p)
	if err != nil {
		return nil, 0, err
	}
	if len(raw) > updates.MaxPresetBytes {
		return nil, 0, fmt.Errorf("%s: больше %d байт", p, updates.MaxPresetBytes)
	}
	pr, err := presets.LoadPreset(raw)
	if err != nil {
		return nil, 0, fmt.Errorf("%s: %w", p, err)
	}
	if pr.ID != id || !pr.Builtin || pr.Revision < 1 {
		return nil, 0, fmt.Errorf("%s: id набора %q, builtin=%v, revision=%d не годятся для публикации набора %q", p, pr.ID, pr.Builtin, pr.Revision, id)
	}
	return raw, pr.Revision, nil
}

// geoSection — секция geo по архиву geo-pack; архив обязан проходить проверку клиента.
func geoSection(zipPath, prefix, date string) (map[string]any, dataFile, error) {
	if !dateRe.MatchString(date) {
		return nil, dataFile{}, fmt.Errorf("-geo-generated-at: дата ГГГГ-ММ-ДД, получено %q", date)
	}
	raw, err := os.ReadFile(zipPath)
	if err != nil {
		return nil, dataFile{}, err
	}
	if err := checkGeoZip(raw); err != nil {
		return nil, dataFile{}, fmt.Errorf("%s: %w", zipPath, err)
	}
	rel := path.Join(prefix, "geo-"+date+".zip")
	sec := map[string]any{"path": rel, "sha256": sha256Hex(raw), "length": len(raw), "generatedAt": date}
	return sec, dataFile{rel, raw}, nil
}

// writeDataOut копирует файлы данных под их именами на источнике.
func writeDataOut(dir string, files []dataFile) error {
	if dir == "" {
		return nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	var errs []error
	for _, f := range files {
		errs = append(errs, writeFile(filepath.Join(dir, path.Base(f.rel)), f.data, 0o644))
	}
	return errors.Join(errs...)
}
