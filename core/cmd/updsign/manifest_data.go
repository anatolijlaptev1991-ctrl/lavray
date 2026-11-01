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
	geoRev     int64  // монотонная ревизия гео-набора (0 — unix-время)
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

// dataPlan — секции данных, файлы для публикации и что сверять с опубликованным манифестом.
type dataPlan struct {
	doc        map[string]any
	files      []dataFile
	presetRevs map[string]int
	geoRev     int64
	geoSha     string
}

// sections строит секции presets и geo.
func (d dataOpts) sections(now time.Time) (*dataPlan, error) {
	plan := &dataPlan{doc: map[string]any{}, presetRevs: map[string]int{}}
	if d.presetsDir != "" {
		sec, fs, err := presetsSection(d.presetsDir, d.prefix, plan.presetRevs)
		if err != nil {
			return nil, err
		}
		plan.doc["presets"], plan.files = sec, append(plan.files, fs...)
	}
	if d.geoZip != "" {
		date, rev := d.geoDate, d.geoRev
		if date == "" {
			date = now.UTC().Format("2006-01-02")
		}
		if rev == 0 {
			rev = now.Unix()
		}
		sec, f, err := geoSection(d.geoZip, d.prefix, date, rev)
		if err != nil {
			return nil, err
		}
		plan.doc["geo"], plan.files = sec, append(plan.files, f)
		plan.geoRev, plan.geoSha = rev, sec["sha256"].(string)
	}
	return plan, nil
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
func geoSection(zipPath, prefix, date string, rev int64) (map[string]any, dataFile, error) {
	if !dateRe.MatchString(date) {
		return nil, dataFile{}, fmt.Errorf("-geo-generated-at: дата ГГГГ-ММ-ДД, получено %q", date)
	}
	if rev < 1 || rev > updates.MaxGeoRev {
		return nil, dataFile{}, fmt.Errorf("-geo-rev: ревизия вне 1…%d, получено %d", updates.MaxGeoRev, rev)
	}
	raw, err := os.ReadFile(zipPath)
	if err != nil {
		return nil, dataFile{}, err
	}
	if err := checkGeoZip(raw); err != nil {
		return nil, dataFile{}, fmt.Errorf("%s: %w", zipPath, err)
	}
	rel := path.Join(prefix, "geo-"+date+".zip")
	sec := map[string]any{"path": rel, "sha256": sha256Hex(raw), "length": len(raw), "generatedAt": date, "rev": rev}
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
