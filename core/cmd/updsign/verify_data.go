// SPDX-License-Identifier: GPL-3.0-only

package main

// verify_data.go — проверка секций presets и geo манифеста командой verify
// (T-75/7.5): подпись манифеста уже проверена клиентской цепочкой, здесь —
// файлы данных против sha256, длины и содержимого (как их проверит клиент).

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/presets"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// verifyData проверяет наборы и гео-архив канала; без assetsDir — только разбор секций.
func (c *cli) verifyData(mf *updates.Manifest, assetsDir string) error {
	ids := make([]string, 0, len(mf.Presets))
	for id := range mf.Presets {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if err := c.verifyPreset(id, mf.Presets[id], assetsDir); err != nil {
			return fmt.Errorf("набор %s: %w", id, err)
		}
	}
	if mf.Geo != nil {
		if err := c.verifyGeo(*mf.Geo, assetsDir); err != nil {
			return fmt.Errorf("гео-набор: %w", err)
		}
	}
	return nil
}

func dataFilePath(assetsDir, rel string) string { return filepath.Join(assetsDir, path.Base(rel)) }

func (c *cli) verifyPreset(id string, e updates.PresetEntry, assetsDir string) error {
	if assetsDir == "" {
		fmt.Fprintf(c.out, "ok  набор %s (rev %d): записан в подписанном манифесте, файл не проверен (нет -assets)\n", id, e.Rev)
		return nil
	}
	raw, err := os.ReadFile(dataFilePath(assetsDir, e.Path))
	if err != nil {
		return err
	}
	if len(raw) > updates.MaxPresetBytes {
		return fmt.Errorf("%w: файл больше %d байт", updates.ErrTooLarge, updates.MaxPresetBytes)
	}
	if err := updates.CheckSha256(raw, e.Sha256); err != nil {
		return err
	}
	p, err := presets.LoadPreset(raw)
	if err != nil {
		return err
	}
	if p.ID != id || !p.Builtin || int64(p.Revision) != e.Rev {
		return fmt.Errorf("id %q, builtin=%v, revision=%d файла не согласованы с манифестом (rev %d)", p.ID, p.Builtin, p.Revision, e.Rev)
	}
	fmt.Fprintf(c.out, "ok  набор %s (rev %d): sha256 и содержимое сошлись\n", id, e.Rev)
	return nil
}

func (c *cli) verifyGeo(g updates.GeoSection, assetsDir string) error {
	if assetsDir == "" {
		fmt.Fprintf(c.out, "ok  гео-набор: записан в подписанном манифесте, файл не проверен (нет -assets)\n")
		return nil
	}
	raw, err := os.ReadFile(dataFilePath(assetsDir, g.Path))
	if err != nil {
		return err
	}
	if int64(len(raw)) != g.Length {
		return fmt.Errorf("%w: файл %d байт, в манифесте %d", updates.ErrLengthMismatch, len(raw), g.Length)
	}
	if err := updates.CheckSha256(raw, g.Sha256); err != nil {
		return err
	}
	if err := checkGeoZip(raw); err != nil {
		return err
	}
	fmt.Fprintf(c.out, "ok  гео-набор: sha256, длина и распаковка сошлись\n")
	return nil
}
