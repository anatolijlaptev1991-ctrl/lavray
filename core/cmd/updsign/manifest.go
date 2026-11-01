// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

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

// manifest собирает manifest-<канал>.json: для каждого актива считает sha256 и
// длину установщика, подписывает его minisign (ключ роли artifact) с trusted
// comment «product;platform;channel;version;serial» и подписывает сам манифест
// ключом r1.
func (c *cli) manifest(args []string) error {
	fs := flag.NewFlagSet("manifest", flag.ContinueOnError)
	fs.SetOutput(c.errw)
	key, artKey := fs.String("key", "", "ключ r1"), fs.String("artifact-key", "", "ключ a1")
	keyid := fs.String("keyid", "r1", "keyid в root.json")
	product, channel := fs.String("product", "", "lavray-windows"), fs.String("channel", "stable", "stable|beta")
	version, minFrom := fs.String("version", "", "версия приложения"), fs.String("min-upgrade-from", "", "")
	serial := fs.Int64("serial", 0, "serial (0 — текущее unix-время)")
	mandatory := fs.Bool("mandatory", false, "обязательное обновление")
	notes := fs.String("notes", "", "JSON {локаль: текст}")
	out := fs.String("out", "", "manifest-<канал>.json")
	ttl := fs.Duration("expires", 90*24*time.Hour, "срок действия")
	published := fs.String("published-dir", "", "каталог опубликованного meta/: версия обязана быть новее")
	var assets multiFlag
	fs.Var(&assets, "asset", "ПЛАТФОРМА=ПУТЬ=ФАЙЛ (повторяется)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *product == "" || *version == "" || *out == "" || len(assets) == 0 {
		return errors.New("нужны -product, -version, -asset и -out")
	}
	rk, err := c.singleKey(*key)
	if err != nil {
		return err
	}
	ak, err := c.singleKey(*artKey)
	if err != nil {
		return fmt.Errorf("-artifact-key: %w", err)
	}
	if *serial == 0 {
		*serial = time.Now().Unix()
	}
	if err := refuseNotNewer(*published, *channel, *version, *serial); err != nil {
		return err
	}
	app, err := buildApp(assets, ak, claimsBase{*product, *channel, *version, *serial})
	if err != nil {
		return err
	}
	if *minFrom != "" {
		app["minUpgradeFrom"] = *minFrom
	}
	doc := map[string]any{"type": "manifest", "product": *product, "channel": *channel, "serial": *serial,
		"expires": expiresAt(time.Now(), *ttl), "mandatory": *mandatory, "app": app}
	if *notes != "" {
		n, err := readNotes(*notes)
		if err != nil {
			return err
		}
		doc["notes"] = n
	}
	raw, _ := marshalPlain(doc)
	env, err := signDoc(raw, map[string]secretKey{*keyid: rk})
	if err != nil {
		return err
	}
	if e, perr := updates.ParseEnvelope(env); perr != nil {
		return perr
	} else if _, perr = updates.ParseManifest(e.Signed); perr != nil {
		return perr
	}
	fmt.Fprintf(c.out, "manifest-%s.json (serial %d) записан в %s\n", *channel, *serial, *out)
	return writeFile(*out, append(env, '\n'), 0o644)
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

// refuseNotNewer: версия (и serial) обязаны быть новее уже опубликованного
// манифеста канала; нечитаемый опубликованный манифест — отказ, а не «можно».
func refuseNotNewer(dir, channel, version string, serial int64) error {
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
	if err != nil || old.App == nil {
		return fmt.Errorf("опубликованный манифест %s нечитаем: %v", channel, err)
	}
	if updates.CompareVersions(version, old.App.Version) <= 0 {
		return fmt.Errorf("версия %s не новее уже опубликованной %s в канале %s: подписывать откат нельзя", version, old.App.Version, channel)
	}
	if serial <= old.Serial {
		return fmt.Errorf("serial %d не больше опубликованного %d в канале %s", serial, old.Serial, channel)
	}
	return nil
}
