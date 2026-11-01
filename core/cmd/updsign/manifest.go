// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// manifestOpts — флаги команды manifest.
type manifestOpts struct {
	key, artKey, keyid, product, channel string
	version, minFrom, notes, out         string
	published                            string
	serial                               int64
	mandatory                            bool
	ttl                                  time.Duration
	assets                               multiFlag
	data                                 dataOpts
}

func parseManifestFlags(errw io.Writer, args []string) (*manifestOpts, error) {
	o := &manifestOpts{}
	fs := flag.NewFlagSet("manifest", flag.ContinueOnError)
	fs.SetOutput(errw)
	fs.StringVar(&o.key, "key", "", "ключ r1")
	fs.StringVar(&o.artKey, "artifact-key", "", "ключ a1 (нужен, когда есть -asset)")
	fs.StringVar(&o.keyid, "keyid", "r1", "keyid в root.json")
	fs.StringVar(&o.product, "product", "", "lavray-windows")
	fs.StringVar(&o.channel, "channel", "stable", "stable|beta")
	fs.StringVar(&o.version, "version", "", "версия приложения (вместе с -asset)")
	fs.StringVar(&o.minFrom, "min-upgrade-from", "", "")
	fs.Int64Var(&o.serial, "serial", 0, "serial (0 — текущее unix-время)")
	fs.BoolVar(&o.mandatory, "mandatory", false, "обязательное обновление")
	fs.StringVar(&o.notes, "notes", "", "JSON {локаль: текст}")
	fs.StringVar(&o.out, "out", "", "manifest-<канал>.json")
	fs.DurationVar(&o.ttl, "expires", 90*24*time.Hour, "срок действия")
	fs.StringVar(&o.published, "published-dir", "", "каталог опубликованного meta/: версия, serial и ревизии наборов не ниже")
	fs.Var(&o.assets, "asset", "ПЛАТФОРМА=ПУТЬ=ФАЙЛ (повторяется)")
	fs.StringVar(&o.data.presetsDir, "presets-dir", "", "каталог с <id>.json встроенных наборов (секция presets)")
	fs.StringVar(&o.data.geoZip, "geo-zip", "", "архив из geo-pack (секция geo)")
	fs.StringVar(&o.data.geoDate, "geo-generated-at", "", "дата среза гео ГГГГ-ММ-ДД (по умолчанию сегодня, UTC)")
	fs.Int64Var(&o.data.geoRev, "geo-rev", 0, "монотонная ревизия гео-набора (0 — текущее unix-время)")
	fs.StringVar(&o.data.prefix, "data-prefix", "data/", "префикс путей наборов и гео на источнике, например v1.2.0/")
	fs.StringVar(&o.data.outDir, "data-out", "", "каталог, куда скопировать файлы наборов и гео под их именами на источнике")
	return o, fs.Parse(args)
}

func (o *manifestOpts) validate() error {
	hasApp := len(o.assets) > 0
	switch {
	case o.product == "" || o.out == "":
		return errors.New("нужны -product и -out")
	case !hasApp && !o.data.any():
		return errors.New("нечего публиковать: нужны -asset (с -version), -presets-dir или -geo-zip")
	case hasApp && o.version == "":
		return errors.New("к -asset нужен -version")
	case !hasApp && o.version != "":
		return errors.New("-version задаётся вместе с -asset")
	}
	return nil
}

// manifest собирает manifest-<канал>.json: для каждого актива считает sha256 и
// длину установщика, подписывает его minisign (ключ роли artifact) с trusted
// comment «product;platform;channel;version;serial»; наборы и гео-архив
// (-presets-dir, -geo-zip) попадают в секции presets и geo с sha256, длиной и
// ревизией; сам манифест подписывается ключом r1. Манифест без -asset — «манифест
// данных»: секции app в нём нет, приложение клиентам не предлагается.
func (c *cli) manifest(args []string) error {
	o, err := parseManifestFlags(c.errw, args)
	if err != nil {
		return err
	}
	if err := o.validate(); err != nil {
		return err
	}
	rk, err := c.singleKey(o.key)
	if err != nil {
		return err
	}
	if o.serial == 0 {
		o.serial = time.Now().Unix()
	}
	doc, files, err := c.manifestDoc(o)
	if err != nil {
		return err
	}
	raw, _ := marshalPlain(doc)
	env, err := signDoc(raw, map[string]secretKey{o.keyid: rk})
	if err != nil {
		return err
	}
	if e, perr := updates.ParseEnvelope(env); perr != nil {
		return perr
	} else if _, perr = updates.ParseManifest(e.Signed); perr != nil {
		return perr
	}
	if err := writeDataOut(o.data.outDir, files); err != nil {
		return err
	}
	fmt.Fprintf(c.out, "manifest-%s.json (serial %d) записан в %s\n", o.channel, o.serial, o.out)
	return writeFile(o.out, append(env, '\n'), 0o644)
}

// manifestDoc собирает подписываемый документ и список файлов данных.
func (c *cli) manifestDoc(o *manifestOpts) (map[string]any, []dataFile, error) {
	plan, err := o.data.sections(time.Now())
	if err != nil {
		return nil, nil, err
	}
	if err := refuseNotNewer(o.published, o.channel, o.version, o.serial, plan); err != nil {
		return nil, nil, err
	}
	doc, files := plan.doc, plan.files
	doc["type"], doc["product"], doc["channel"], doc["serial"] = "manifest", o.product, o.channel, o.serial
	doc["expires"], doc["mandatory"] = expiresAt(time.Now(), o.ttl), o.mandatory
	if len(o.assets) > 0 {
		app, err := c.appSection(o)
		if err != nil {
			return nil, nil, err
		}
		doc["app"] = app
	}
	if o.notes != "" {
		n, err := readNotes(o.notes)
		if err != nil {
			return nil, nil, err
		}
		doc["notes"] = n
	}
	return doc, files, nil
}

func (c *cli) appSection(o *manifestOpts) (map[string]any, error) {
	ak, err := c.singleKey(o.artKey)
	if err != nil {
		return nil, fmt.Errorf("-artifact-key: %w", err)
	}
	app, err := buildApp(o.assets, ak, claimsBase{o.product, o.channel, o.version, o.serial})
	if err != nil {
		return nil, err
	}
	if o.minFrom != "" {
		app["minUpgradeFrom"] = o.minFrom
	}
	return app, nil
}
