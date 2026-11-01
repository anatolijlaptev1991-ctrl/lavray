// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/presets"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// geoPack собирает детерминированный zip гео-набора из каталога с geoip/ и
// geosite/ (updates.PackGeoZip) и проверяет, что клиент его примет: полный набор
// встроенных файлов, лимиты распаковки, корректные .srs. Ссылки, не .srs и любые
// чужие файлы — отказ; при отказе выходной файл не создаётся.
func (c *cli) geoPack(args []string) error {
	fs := flag.NewFlagSet("geo-pack", flag.ContinueOnError)
	fs.SetOutput(c.errw)
	in, out := fs.String("in", "", "каталог с geoip/ и geosite/ (*.srs)"), fs.String("out", "", "куда записать geo.zip")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *in == "" || *out == "" {
		return errors.New("нужны -in и -out")
	}
	raw, err := updates.PackGeoZip(*in)
	if err != nil {
		return err
	}
	if err := checkGeoZip(raw); err != nil {
		return fmt.Errorf("набор не пройдёт проверку клиента: %w", err)
	}
	if err := writeFile(*out, raw, 0o644); err != nil {
		return err
	}
	fmt.Fprintf(c.out, "%s записан: %d байт, sha256 %s\n", *out, len(raw), sha256Hex(raw))
	return nil
}

// checkGeoZip применяет архив во временный каталог тем же кодом, что и клиент.
func checkGeoZip(raw []byte) error {
	required, err := presets.EmbeddedGeoFiles()
	if err != nil {
		return err
	}
	tmp, err := os.MkdirTemp("", "updsign-geo-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	sec := updates.GeoSection{Sha256: sha256Hex(raw), Length: int64(len(raw))}
	_, err = updates.ApplyGeo(filepath.Join(tmp, "geo"), raw, sec, updates.DefaultGeoLimits, required)
	return err
}
