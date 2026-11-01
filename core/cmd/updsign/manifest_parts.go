// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// assetSpec — «ПЛАТФОРМА=ПУТЬ_НА_ИСТОЧНИКЕ=ЛОКАЛЬНЫЙ_ФАЙЛ».
type assetSpec struct{ platform, path, file string }

func parseAssetSpec(s string) (assetSpec, error) {
	p := strings.SplitN(s, "=", 3)
	if len(p) != 3 || p[0] == "" || p[1] == "" || p[2] == "" {
		return assetSpec{}, fmt.Errorf("актив задаётся как ПЛАТФОРМА=ПУТЬ=ФАЙЛ, получено %q", s)
	}
	return assetSpec{p[0], p[1], p[2]}, nil
}

type claimsBase struct {
	product, channel, version string
	serial                    int64
}

// buildApp — секция app: активы с sha256, длиной и подписью minisign.
func buildApp(specs []string, ak secretKey, cb claimsBase) (map[string]any, error) {
	assets := map[string]any{}
	for _, s := range specs {
		a, err := parseAssetSpec(s)
		if err != nil {
			return nil, err
		}
		data, err := os.ReadFile(a.file)
		if err != nil {
			return nil, fmt.Errorf("установщик %s: %w", a.file, err)
		}
		claims := updates.ArtifactClaims{Product: cb.product, Platform: a.platform, Channel: cb.channel, Version: cb.version, Serial: cb.serial}
		assets[a.platform] = map[string]any{
			"path": path.Clean(a.path), "sha256": sha256Hex(data), "length": len(data),
			"minisig": string(signArtifact(ak, data, claims)),
		}
	}
	return map[string]any{"version": cb.version, "assets": assets}, nil
}

func readNotes(p string) (map[string]string, error) {
	raw, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	var n map[string]string
	if err := json.Unmarshal(raw, &n); err != nil {
		return nil, fmt.Errorf("%s: ожидается JSON {локаль: текст}: %w", p, err)
	}
	return n, nil
}

// refuseNotNewer: версия приложения (если она есть) и serial обязаны быть новее
// уже опубликованного манифеста канала, а ревизия набора — не ниже опубликованной
// (равная допустима: данные без изменений в новом релизе). Нечитаемый
// опубликованный манифест — отказ, а не «можно».
func refuseNotNewer(dir, channel, version string, serial int64, revs map[string]int) error {
	if dir == "" {
		return nil
	}
	raw, err := os.ReadFile(filepath.Join(dir, updates.ManifestName(channel)))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	env, err := updates.ParseEnvelope(raw)
	if err != nil {
		return fmt.Errorf("опубликованный манифест %s нечитаем: %w", channel, err)
	}
	old, err := updates.ParseManifest(env.Signed)
	if err != nil {
		return fmt.Errorf("опубликованный манифест %s нечитаем: %v", channel, err)
	}
	if version != "" && old.App != nil && updates.CompareVersions(version, old.App.Version) <= 0 {
		return fmt.Errorf("версия %s не новее уже опубликованной %s в канале %s: подписывать откат нельзя", version, old.App.Version, channel)
	}
	if serial <= old.Serial {
		return fmt.Errorf("serial %d не больше опубликованного %d в канале %s", serial, old.Serial, channel)
	}
	for id, rev := range revs {
		if e, ok := old.Presets[id]; ok && int64(rev) < e.Rev {
			return fmt.Errorf("набор %s: ревизия %d ниже опубликованной %d в канале %s: подписывать откат нельзя", id, rev, e.Rev, channel)
		}
	}
	return nil
}
