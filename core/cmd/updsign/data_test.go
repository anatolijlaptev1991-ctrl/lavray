// SPDX-License-Identifier: GPL-3.0-only

package main

// data_test.go — публикация пресетов и гео-набора (T-75/7.5): geo-pack, секции
// presets/geo в manifest, проверка verify и полный круг «выпуск → клиент».

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/presets"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

const genDate = "2026-10-20"

// builtinRev — встроенная ревизия набора id.
func builtinRev(t *testing.T, id string) int {
	t.Helper()
	list, err := presets.BuiltinPresets()
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range list {
		if p.ID == id {
			return p.Revision
		}
	}
	t.Fatalf("нет набора %q", id)
	return 0
}

// writePreset кладёт в dir файл <id>.json: встроенный набор id ревизии rev с доменом-маркером.
func writePreset(t *testing.T, dir, id string, rev int, marker string) []byte {
	t.Helper()
	list, _ := presets.BuiltinPresets()
	for _, p := range list {
		if p.ID != id {
			continue
		}
		c := p.Clone()
		c.Revision = rev
		c.Routing.DirectDomain = append(c.Routing.DirectDomain, marker)
		raw, err := json.Marshal(c)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, id+".json"), raw, 0o644); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	t.Fatalf("нет набора %q", id)
	return nil
}

// geoSource раскладывает полный встроенный набор .srs и, если нужно, ещё один файл.
func geoSource(t *testing.T, root, extra string) string {
	t.Helper()
	files, err := presets.EmbeddedGeoFiles()
	if err != nil {
		t.Fatal(err)
	}
	if extra != "" {
		files = append(files, "geosite/"+extra+".srs")
	}
	for _, rel := range files {
		src := rel
		if rel == "geosite/"+extra+".srs" {
			src = "geosite/google.srs"
		}
		raw, err := presets.GeoFile(src)
		if err != nil {
			t.Fatal(err)
		}
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, raw, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func sum(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }

func (h *harness) readManifest(channel string) *updates.Manifest {
	h.t.Helper()
	raw, err := os.ReadFile(h.p("meta/manifest-" + channel + ".json"))
	if err != nil {
		h.t.Fatal(err)
	}
	env, err := updates.ParseEnvelope(raw)
	if err != nil {
		h.t.Fatal(err)
	}
	mf, err := updates.ParseManifest(env.Signed)
	if err != nil {
		h.t.Fatal(err)
	}
	return mf
}

// dataArgs — manifest данных (без установщика): наборы из presetsDir и гео-архив.
func (h *harness) dataArgs(channel, presetsDir, geoZip, extra string) []string {
	h.serial++
	args := []string{"manifest", "-key", "file:" + h.p("manifest.sec"), "-product", "lavray-windows", "-channel", channel,
		"-serial", itoa(h.serial), "-data-prefix", "v1.0.0/", "-geo-generated-at", genDate,
		"-data-out", h.p("site/v1.0.0"), "-out", h.p("meta/manifest-" + channel + ".json")}
	if presetsDir != "" {
		args = append(args, "-presets-dir", presetsDir)
	}
	if geoZip != "" {
		args = append(args, "-geo-zip", geoZip, "-geo-rev", itoa(h.serial))
	}
	if extra != "" {
		args = append(args, "-published-dir", extra)
	}
	return args
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func TestGeoPackWritesDeterministicZip(t *testing.T) {
	h := newHarness(t)
	src := geoSource(t, h.p("geo-src"), "")
	out := h.must("geo-pack", "-in", src, "-out", h.p("geo.zip"))
	raw, err := os.ReadFile(h.p("geo.zip"))
	if err != nil || !strings.Contains(out, sum(raw)) {
		t.Fatalf("geo-pack: %v %s", err, out)
	}
	h.must("geo-pack", "-in", src, "-out", h.p("geo2.zip"))
	again, _ := os.ReadFile(h.p("geo2.zip"))
	if string(raw) != string(again) {
		t.Fatal("архив детерминирован")
	}
}

func TestGeoPackRefusesSymlinkAndNonSrs(t *testing.T) {
	h := newHarness(t)
	src := geoSource(t, h.p("geo-src"), "")
	if err := os.WriteFile(filepath.Join(src, "geosite", "notes.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if code, _, errw := h.run("geo-pack", "-in", src, "-out", h.p("bad.zip")); code == 0 || !strings.Contains(errw, "notes.txt") {
		t.Fatalf("не .srs: код %d %s", code, errw)
	}
	if _, err := os.Stat(h.p("bad.zip")); err == nil {
		t.Fatal("при отказе файл архива не создаётся")
	}
	_ = os.Remove(filepath.Join(src, "geosite", "notes.txt"))
	if err := os.Symlink(filepath.Join(src, "geoip", "cn.srs"), filepath.Join(src, "geosite", "link.srs")); err != nil {
		t.Skipf("символические ссылки недоступны: %v", err)
	}
	if code, _, errw := h.run("geo-pack", "-in", src, "-out", h.p("bad.zip")); code == 0 || !strings.Contains(errw, "link.srs") {
		t.Fatalf("ссылка: код %d %s", code, errw)
	}
}

func TestGeoPackRefusesIncompleteSet(t *testing.T) {
	h := newHarness(t)
	src := h.p("geo-src")
	raw, _ := presets.GeoFile("geoip/cn.srs")
	_ = os.MkdirAll(filepath.Join(src, "geoip"), 0o755)
	_ = os.WriteFile(filepath.Join(src, "geoip", "cn.srs"), raw, 0o644)
	if code, _, errw := h.run("geo-pack", "-in", src, "-out", h.p("part.zip")); code == 0 || !strings.Contains(errw, "неполон") {
		t.Fatalf("неполный набор не публикуется: код %d %s", code, errw)
	}
}

func TestManifestWithPresetsAndGeoSections(t *testing.T) {
	h := newHarness(t)
	rev := builtinRev(t, "lav-ru") + 1
	raw := writePreset(t, h.p("presets"), "lav-ru", rev, "full:a.example")
	h.must("geo-pack", "-in", geoSource(t, h.p("geo-src"), "zz-new"), "-out", h.p("geo.zip"))
	zb, _ := os.ReadFile(h.p("geo.zip"))
	h.must(append(h.dataArgs("stable", h.p("presets"), h.p("geo.zip"), ""), "-geo-rev", "7")...)
	mf := h.readManifest("stable")
	if mf.App != nil {
		t.Fatal("манифест данных без приложения")
	}
	e := mf.Presets["lav-ru"]
	wantPath := "v1.0.0/presets-lav-ru-" + itoa(rev) + ".json"
	if len(mf.Presets) != 1 || e.Rev != int64(rev) || e.Path != wantPath || e.Sha256 != sum(raw) {
		t.Fatalf("секция presets: %+v", mf.Presets)
	}
	if g := mf.Geo; g == nil || g.Path != "v1.0.0/geo-"+genDate+".zip" || g.Sha256 != sum(zb) || g.Length != int64(len(zb)) || g.GeneratedAt != genDate || g.Rev != 7 {
		t.Fatalf("секция geo: %+v", mf.Geo)
	}
	for _, name := range []string{"presets-lav-ru-" + itoa(rev) + ".json", "geo-" + genDate + ".zip"} {
		if _, err := os.Stat(h.p("site/v1.0.0/" + name)); err != nil {
			t.Errorf("-data-out не положил %s: %v", name, err)
		}
	}
}

// Данные вместе с приложением: секции app, presets и geo в одном подписанном документе.
func TestManifestCombinesAppAndData(t *testing.T) {
	h := newHarness(t)
	writePreset(t, h.p("presets"), "lav-cn", builtinRev(t, "lav-cn")+1, "full:b.example")
	args := append(h.manifestArgs("0.6.0", "stable", "", ""), "-presets-dir", h.p("presets"), "-data-prefix", "v0.6.0/")
	h.must(args...)
	mf := h.readManifest("stable")
	if mf.App == nil || mf.App.Version != "0.6.0" || len(mf.Presets) != 1 || mf.Geo != nil {
		t.Fatalf("манифест: app=%v presets=%v geo=%v", mf.App, mf.Presets, mf.Geo)
	}
	if !strings.HasPrefix(mf.Presets["lav-cn"].Path, "v0.6.0/presets-lav-cn-") {
		t.Fatalf("путь набора: %q", mf.Presets["lav-cn"].Path)
	}
}

func TestManifestNeedsSomethingToPublish(t *testing.T) {
	h := newHarness(t)
	args := []string{"manifest", "-key", "file:" + h.p("manifest.sec"), "-product", "lavray-windows", "-out", h.p("meta/manifest-stable.json")}
	if code, _, errw := h.run(args...); code == 0 || !strings.Contains(errw, "-asset") {
		t.Fatalf("пустой манифест: код %d %s", code, errw)
	}
	h.serial++
	withVersionOnly := append(args, "-version", "1.0.0")
	if code, _, _ := h.run(withVersionOnly...); code == 0 {
		t.Fatal("версия без установщиков и данных — не манифест")
	}
}

// S: в каталоге наборов только файлы <id>.json встроенных наборов с согласованным содержимым.
func TestManifestRefusesBadPresets(t *testing.T) {
	h := newHarness(t)
	rev := builtinRev(t, "lav-ru") + 1
	cases := map[string]func(dir string){
		"foreign_id_file": func(dir string) {
			raw := writePreset(t, dir, "lav-ru", rev, "full:a.example")
			_ = os.WriteFile(filepath.Join(dir, "evil-set.json"), raw, 0o644)
		},
		"file_name_differs_from_id": func(dir string) {
			raw := writePreset(t, dir, "lav-ru", rev, "full:a.example")
			_ = os.Remove(filepath.Join(dir, "lav-ru.json"))
			_ = os.WriteFile(filepath.Join(dir, "global.json"), raw, 0o644)
		},
		"foreign_id_consistent_content": func(dir string) {
			raw := writePreset(t, dir, "lav-ru", rev, "full:a.example")
			_ = os.Remove(filepath.Join(dir, "lav-ru.json"))
			foreign := strings.Replace(string(raw), `"id":"lav-ru"`, `"id":"evil-set"`, 1)
			_ = os.WriteFile(filepath.Join(dir, "evil-set.json"), []byte(foreign), 0o644)
		},
		"invalid_preset": func(dir string) {
			_ = os.WriteFile(filepath.Join(dir, "lav-ru.json"), []byte(`{"id":"lav-ru","version":1}`), 0o644)
		},
		"not_json": func(dir string) { _ = os.WriteFile(filepath.Join(dir, "lav-ru.json"), []byte("{broken"), 0o644) },
		"not_builtin_flag": func(dir string) {
			raw := writePreset(t, dir, "lav-ru", rev, "full:a.example")
			_ = os.WriteFile(filepath.Join(dir, "lav-ru.json"), []byte(strings.Replace(string(raw), `"builtin":true`, `"builtin":false`, 1)), 0o644)
		},
		"empty_dir": func(dir string) {},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), "presets")
			_ = os.MkdirAll(dir, 0o755)
			mutate(dir)
			if code, _, errw := h.run(h.dataArgs("stable", dir, "", "")...); code == 0 {
				t.Fatalf("ожидался отказ, вывод: %s", errw)
			}
		})
	}
}

// Файлы, не являющиеся наборами (README, исходные списки), каталог не портят.
func TestManifestIgnoresNonPresetFiles(t *testing.T) {
	h := newHarness(t)
	dir := h.p("presets")
	writePreset(t, dir, "lav-ru", builtinRev(t, "lav-ru")+1, "full:a.example")
	_ = os.WriteFile(filepath.Join(dir, "README.md"), []byte("x"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "lav-ru.source.json"), []byte(`{"lists":[]}`), 0o644)
	h.must(h.dataArgs("stable", dir, "", "")...)
	if mf := h.readManifest("stable"); len(mf.Presets) != 1 {
		t.Fatalf("наборы: %v", mf.Presets)
	}
}

// S: ревизия набора ниже уже опубликованной отвергается; равная (повтор данных
// в новом релизе) и выше — допустимы.
func TestManifestRefusesOlderPresetRevThanPublished(t *testing.T) {
	h := newHarness(t)
	base := builtinRev(t, "lav-ru")
	writePreset(t, h.p("presets"), "lav-ru", base+3, "full:a.example")
	h.must(h.dataArgs("stable", h.p("presets"), "", "")...)
	published := h.p("meta")

	writePreset(t, h.p("older"), "lav-ru", base+2, "full:old.example")
	if code, _, errw := h.run(h.dataArgs("stable", h.p("older"), "", published)...); code == 0 || !strings.Contains(errw, "ниже опубликованной") {
		t.Fatalf("откат ревизии: код %d %s", code, errw)
	}
	writePreset(t, h.p("same"), "lav-ru", base+3, "full:a.example")
	h.must(h.dataArgs("stable", h.p("same"), "", published)...)
	writePreset(t, h.p("newer"), "lav-ru", base+4, "full:new.example")
	h.must(h.dataArgs("stable", h.p("newer"), "", published)...)
}

func TestVerifyChecksPresetAndGeoFiles(t *testing.T) {
	h := newHarness(t)
	rev := builtinRev(t, "lav-ru") + 1
	writePreset(t, h.p("presets"), "lav-ru", rev, "full:a.example")
	h.must("geo-pack", "-in", geoSource(t, h.p("geo-src"), "zz-new"), "-out", h.p("geo.zip"))
	h.must(h.dataArgs("stable", h.p("presets"), h.p("geo.zip"), "")...)
	h.must("timestamp", "-key", "file:"+h.p("timestamp.sec"), "-dir", h.p("meta"), "-out", h.p("meta/timestamp.json"))

	out := h.must("verify", "-root", h.root, "-dir", h.p("meta"), "-assets", h.p("site/v1.0.0"), "-product", "lavray-windows")
	if !strings.Contains(out, "набор lav-ru") || !strings.Contains(out, "гео-набор") || !strings.HasSuffix(strings.TrimSpace(out), "ok") {
		t.Fatalf("verify: %s", out)
	}
	if out = h.must("verify", "-root", h.root, "-dir", h.p("meta")); !strings.Contains(out, "файл не проверен") {
		t.Fatalf("verify без -assets: %s", out)
	}

	// Подмена набора: sha256 не сходится с манифестом.
	pf := h.p("site/v1.0.0/presets-lav-ru-" + itoa(rev) + ".json")
	orig, _ := os.ReadFile(pf)
	_ = os.WriteFile(pf, append([]byte(" "), orig...), 0o644)
	if code, _, errw := h.run("verify", "-root", h.root, "-dir", h.p("meta"), "-assets", h.p("site/v1.0.0")); code == 0 || !strings.Contains(errw, "sha256") {
		t.Fatalf("подменённый набор: код %d %s", code, errw)
	}
	_ = os.WriteFile(pf, orig, 0o644)
	// Подмена архива гео.
	gf := h.p("site/v1.0.0/geo-" + genDate + ".zip")
	zorig, _ := os.ReadFile(gf)
	tampered := append([]byte(nil), zorig...)
	tampered[len(tampered)/2] ^= 0xff
	_ = os.WriteFile(gf, tampered, 0o644)
	if code, _, errw := h.run("verify", "-root", h.root, "-dir", h.p("meta"), "-assets", h.p("site/v1.0.0")); code == 0 || !strings.Contains(errw, "sha256") {
		t.Fatalf("подменённый архив: код %d %s", code, errw)
	}
	// Файла нет вовсе.
	_ = os.Remove(gf)
	if code, _, errw := h.run("verify", "-root", h.root, "-dir", h.p("meta"), "-assets", h.p("site/v1.0.0")); code == 0 || !strings.Contains(errw, "geo-"+genDate) {
		t.Fatalf("нет архива: код %d %s", code, errw)
	}
}

// -channel: данные проверяются только у выпускаемого канала.
func TestVerifyChannelFilterCoversData(t *testing.T) {
	h := newHarness(t)
	rev := builtinRev(t, "lav-ru") + 1
	writePreset(t, h.p("presets"), "lav-ru", rev, "full:a.example")
	h.release("0.5.1", "stable", []byte("installer-0.5.1")) // стабильный канал без данных
	h.must(h.dataArgs("beta", h.p("presets"), "", "")...)
	h.must("timestamp", "-key", "file:"+h.p("timestamp.sec"), "-dir", h.p("meta"), "-out", h.p("meta/timestamp.json"))
	pf := h.p("site/v1.0.0/presets-lav-ru-" + itoa(rev) + ".json")
	_ = os.WriteFile(pf, []byte("tampered"), 0o644)
	assets := h.p("site/v1.0.0")
	_ = os.Link(h.p("dist/LAVRay-0.5.1-x64-setup.exe"), filepath.Join(assets, "LAVRay-0.5.1-x64-setup.exe"))
	if _, err := os.Stat(filepath.Join(assets, "LAVRay-0.5.1-x64-setup.exe")); err != nil {
		raw, _ := os.ReadFile(h.p("dist/LAVRay-0.5.1-x64-setup.exe"))
		_ = os.WriteFile(filepath.Join(assets, "LAVRay-0.5.1-x64-setup.exe"), raw, 0o644)
	}
	if code, _, errw := h.run("verify", "-root", h.root, "-dir", h.p("meta"), "-assets", assets, "-channel", "stable"); code != 0 {
		t.Fatalf("стабильный канал не зависит от данных беты: код %d %s", code, errw)
	}
	if code, _, errw := h.run("verify", "-root", h.root, "-dir", h.p("meta"), "-assets", assets, "-channel", "beta"); code == 0 || !strings.Contains(errw, "sha256") {
		t.Fatalf("бета с подменённым набором: код %d %s", code, errw)
	}
}

// Подпись манифеста с данными переживает продление срока (resign не трогает секции).
func TestResignKeepsDataSections(t *testing.T) {
	h := newHarness(t)
	writePreset(t, h.p("presets"), "lav-ru", builtinRev(t, "lav-ru")+1, "full:a.example")
	h.must(h.dataArgs("stable", h.p("presets"), "", "")...)
	before := h.readManifest("stable")
	h.must("resign", "-key", "file:"+h.p("manifest.sec"), "-in", h.p("meta/manifest-stable.json"), "-out", h.p("meta/manifest-stable.json"))
	after := h.readManifest("stable")
	if len(after.Presets) != 1 || after.Presets["lav-ru"] != before.Presets["lav-ru"] {
		t.Fatalf("секции изменились: %+v → %+v", before.Presets, after.Presets)
	}
}

// Полный круг: genkey → geo-pack → manifest → timestamp → verify → клиент
// скачивает, проверяет и применяет наборы и гео → откат. Подмены и откат ревизии отвергаются.
func TestPublishThenClientAppliesAndRollsBack(t *testing.T) {
	h := newHarness(t)
	base := builtinRev(t, "lav-ru")
	site := h.p("site")
	writePreset(t, h.p("presets"), "lav-ru", base+1, "full:round.example")
	h.must("geo-pack", "-in", geoSource(t, h.p("geo-src"), "zz-new"), "-out", h.p("geo.zip"))
	h.must(h.dataArgs("stable", h.p("presets"), h.p("geo.zip"), "")...)
	h.must("timestamp", "-key", "file:"+h.p("timestamp.sec"), "-dir", h.p("meta"), "-out", h.p("meta/timestamp.json"))
	h.must("verify", "-root", h.root, "-dir", h.p("meta"), "-assets", site+"/v1.0.0", "-product", "lavray-windows")
	for _, f := range []string{"manifest-stable.json", "timestamp.json", "root.json"} { // meta/ и данные — один «сайт»
		raw, _ := os.ReadFile(h.p("meta/" + f))
		_ = os.WriteFile(filepath.Join(site, f), raw, 0o644)
	}
	rootRaw, _ := os.ReadFile(h.root)
	trust, err := updates.NewTrust(rootRaw)
	if err != nil {
		t.Fatal(err)
	}
	cl := &updates.Client{Trust: trust, Product: "lavray-windows", AppVersion: "0.5.0", Channel: "stable",
		BootstrapSources: []updates.Source{dirSource{dir: site}}, State: &updates.State{}, PhaseTimeout: 10 * time.Second}
	res, err := cl.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	data := t.TempDir()
	overrideDir := presets.OverrideDir(data)
	if err := presets.EnsureGeo(data); err != nil {
		t.Fatal(err)
	}
	applyPresets(t, res, overrideDir)
	list, _ := presets.BuiltinPresetsWith(overrideDir)
	for _, p := range list {
		if p.ID == "lav-ru" && p.Revision != base+1 {
			t.Fatalf("lav-ru: ревизия %d, ожидалась %d", p.Revision, base+1)
		}
	}
	geoDir := filepath.Join(data, "geo")
	applyGeo(t, res, geoDir)
	if _, err := os.Stat(filepath.Join(geoDir, "geosite", "zz-new.srs")); err != nil {
		t.Fatal("гео-набор применён:", err)
	}

	// Откат возвращает прежние данные.
	if err := updates.RollbackPresets(overrideDir); err != nil {
		t.Fatal(err)
	}
	if err := updates.RollbackGeo(geoDir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(geoDir, "geosite", "zz-new.srs")); err == nil {
		t.Fatal("после отката нового файла нет")
	}
	list, _ = presets.BuiltinPresetsWith(overrideDir)
	for _, p := range list {
		if p.ID == "lav-ru" && p.Revision != base {
			t.Fatalf("после отката lav-ru r%d", p.Revision)
		}
	}
	if err := updates.RollbackGeo(geoDir); !errors.Is(err, updates.ErrNoPrevious) {
		t.Fatalf("повторный откат: %v", err)
	}
}

func fetchBlob(t *testing.T, res *updates.Result, spec updates.BlobSpec) ([]byte, error) {
	t.Helper()
	return updates.FetchBlob(context.Background(), res.Mirrors, spec, nil)
}

func applyPresets(t *testing.T, res *updates.Result, overrideDir string) {
	t.Helper()
	installed, _ := presets.BuiltinPresetsWith(overrideDir)
	offers := updates.PendingPresets(res.Manifest, installed)
	if len(offers) != 1 || offers[0].ID != "lav-ru" {
		t.Fatalf("предложения: %+v", offers)
	}
	var files []updates.PresetFile
	for _, o := range offers {
		e := res.Manifest.Presets[o.ID]
		data, err := fetchBlob(t, res, updates.BlobSpec{Path: e.Path, Sha256: e.Sha256, Max: updates.MaxPresetBytes})
		if err != nil {
			t.Fatal(err)
		}
		files = append(files, updates.PresetFile{ID: o.ID, Data: data})
	}
	if _, err := updates.ApplyPresets(overrideDir, res.Manifest, files); err != nil {
		t.Fatal(err)
	}
	// Та же ревизия повторно не принимается (rev не новее установленной).
	if _, err := updates.ApplyPresets(overrideDir, res.Manifest, files); !errors.Is(err, updates.ErrPresetNotNewer) {
		t.Fatalf("повторное применение той же ревизии: %v", err)
	}
	if again, _ := presets.BuiltinPresetsWith(overrideDir); len(updates.PendingPresets(res.Manifest, again)) != 0 {
		t.Fatal("после применения набор больше не предлагается")
	}
}

func applyGeo(t *testing.T, res *updates.Result, geoDir string) {
	t.Helper()
	sec := updates.PendingGeo(res.Manifest, updates.InstalledGeo(geoDir))
	if sec == nil {
		t.Fatal("гео-набор должен предлагаться")
	}
	data, err := fetchBlob(t, res, updates.BlobSpec{Path: sec.Path, Sha256: sec.Sha256, Length: sec.Length})
	if err != nil {
		t.Fatal(err)
	}
	required, _ := presets.EmbeddedGeoFiles()
	// Подмена архива после подписи манифеста отвергается.
	bad := append([]byte(nil), data...)
	bad[len(bad)/2] ^= 0xff
	if _, err := updates.ApplyGeo(geoDir, bad, *sec, updates.DefaultGeoLimits, required); !errors.Is(err, updates.ErrHashMismatch) {
		t.Fatalf("подменённый архив: %v", err)
	}
	if res, err := updates.ApplyGeo(geoDir, data, *sec, updates.DefaultGeoLimits, required); err != nil || !res.Changed {
		t.Fatalf("ApplyGeo: %+v %v", res, err)
	}
}

// S: подменённый на источнике архив клиент не скачивает (sha256 из подписанного манифеста).
func TestClientRejectsTamperedZipFromSite(t *testing.T) {
	h := newHarness(t)
	site := h.p("site")
	h.must("geo-pack", "-in", geoSource(t, h.p("geo-src"), "zz-new"), "-out", h.p("geo.zip"))
	h.must(h.dataArgs("stable", "", h.p("geo.zip"), "")...)
	h.must("timestamp", "-key", "file:"+h.p("timestamp.sec"), "-dir", h.p("meta"), "-out", h.p("meta/timestamp.json"))
	for _, f := range []string{"manifest-stable.json", "timestamp.json"} {
		raw, _ := os.ReadFile(h.p("meta/" + f))
		_ = os.WriteFile(filepath.Join(site, f), raw, 0o644)
	}
	zf := filepath.Join(site, "v1.0.0", "geo-"+genDate+".zip")
	raw, _ := os.ReadFile(zf)
	raw[len(raw)/3] ^= 0xff
	_ = os.WriteFile(zf, raw, 0o644)
	rootRaw, _ := os.ReadFile(h.root)
	trust, _ := updates.NewTrust(rootRaw)
	cl := &updates.Client{Trust: trust, Product: "lavray-windows", AppVersion: "0.5.0",
		BootstrapSources: []updates.Source{dirSource{dir: site}}, State: &updates.State{}, PhaseTimeout: 10 * time.Second}
	res, err := cl.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	sec := res.Manifest.Geo
	if _, err := fetchBlob(t, res, updates.BlobSpec{Path: sec.Path, Sha256: sec.Sha256, Length: sec.Length}); !errors.Is(err, updates.ErrHashMismatch) {
		t.Fatalf("подменённый архив на источнике: %v", err)
	}
}

// Архив не из geo-pack (неполный набор) в манифест не попадает: он не пройдёт клиента.
func TestManifestRefusesGeoZipTheClientWouldReject(t *testing.T) {
	h := newHarness(t)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("geoip/cn.srs")
	raw, _ := presets.GeoFile("geoip/cn.srs")
	_, _ = w.Write(raw)
	_ = zw.Close()
	_ = os.WriteFile(h.p("partial.zip"), buf.Bytes(), 0o644)
	if code, _, errw := h.run(h.dataArgs("stable", "", h.p("partial.zip"), "")...); code == 0 || !strings.Contains(errw, "неполон") {
		t.Fatalf("неполный архив: код %d %s", code, errw)
	}
	if _, err := os.Stat(h.p("meta/manifest-stable.json")); err == nil {
		t.Fatal("манифест не должен быть записан")
	}
}

// Ревизия гео монотонна: без -geo-rev берётся текущее unix-время, отрицательные и выше потолка не принимаются.
func TestManifestGeoRevDefaultAndBounds(t *testing.T) {
	h := newHarness(t)
	h.must("geo-pack", "-in", geoSource(t, h.p("geo-src"), "zz-new"), "-out", h.p("geo.zip"))
	args := h.dataArgs("stable", "", h.p("geo.zip"), "")
	args = args[:len(args)-2] // без -geo-rev: значение по умолчанию
	h.must(args...)
	if g := h.readManifest("stable").Geo; g == nil || g.Rev < 1_000_000_000 {
		t.Fatalf("ревизия по умолчанию — unix-время: %+v", g)
	}
	for _, bad := range []string{"-3", "99999999999999999"} {
		if code, _, _ := h.run(append(h.dataArgs("stable", "", h.p("geo.zip"), ""), "-geo-rev", bad)...); code == 0 {
			t.Errorf("-geo-rev %s должен отвергаться", bad)
		}
	}
}

// S: гео-набор с ревизией ниже опубликованной (или равной при другом содержимом) не подписывается.
func TestManifestRefusesOlderGeoRevThanPublished(t *testing.T) {
	h := newHarness(t)
	h.must("geo-pack", "-in", geoSource(t, h.p("geo-src"), "zz-one"), "-out", h.p("geo1.zip"))
	h.must("geo-pack", "-in", geoSource(t, h.p("geo-src2"), "zz-two"), "-out", h.p("geo2.zip"))
	h.must(append(h.dataArgs("stable", "", h.p("geo1.zip"), ""), "-geo-rev", "10")...)
	published := h.p("meta")
	older := append(h.dataArgs("stable", "", h.p("geo2.zip"), published), "-geo-rev", "9")
	if code, _, errw := h.run(older...); code == 0 || !strings.Contains(errw, "ниже опубликованной") {
		t.Fatalf("откат ревизии гео: код %d %s", code, errw)
	}
	sameRevOtherData := append(h.dataArgs("stable", "", h.p("geo2.zip"), published), "-geo-rev", "10")
	if code, _, errw := h.run(sameRevOtherData...); code == 0 || !strings.Contains(errw, "ревизия 10") {
		t.Fatalf("та же ревизия с другим содержимым: код %d %s", code, errw)
	}
	same := append(h.dataArgs("stable", "", h.p("geo1.zip"), published), "-geo-rev", "10")
	h.must(same...) // те же данные в новом релизе допустимы
	h.must(append(h.dataArgs("stable", "", h.p("geo2.zip"), published), "-geo-rev", "11")...)
}
