// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// resign продлевает срок уже подписанного манифеста или sources.json: меняется
// только expires, остальное (версия, активы, подписи minisign установщиков)
// остаётся. Подпись ставится заново ключом r1. Именно эта команда запускается
// ручным workflow meta-resign в Environment с ревьюером, когда пора продлить
// манифест без нового релиза.
func (c *cli) resign(args []string) error {
	fs := flag.NewFlagSet("resign", flag.ContinueOnError)
	fs.SetOutput(c.errw)
	key, keyid := fs.String("key", "", "ключ r1"), fs.String("keyid", "r1", "keyid в root.json")
	in, out := fs.String("in", "", "подписанный документ"), fs.String("out", "", "куда записать")
	ttl := fs.Duration("expires", 90*24*time.Hour, "новый срок от сейчас")
	if err := fs.Parse(args); err != nil {
		return err
	}
	k, err := c.singleKey(*key)
	if err != nil || *in == "" || *out == "" {
		return errors.Join(err, errors.New("нужны -key, -in и -out"))
	}
	raw, err := os.ReadFile(*in)
	if err != nil {
		return err
	}
	env, err := updates.ParseEnvelope(raw)
	if err != nil {
		return fmt.Errorf("%s: %w", *in, err)
	}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(env.Signed, &doc); err != nil {
		return err
	}
	if t := string(doc["type"]); t != `"manifest"` && t != `"sources"` {
		return fmt.Errorf("%s: продлевать можно только manifest и sources, а не %s", *in, t)
	}
	doc["expires"], _ = json.Marshal(expiresAt(time.Now(), *ttl))
	draft, _ := marshalPlain(doc)
	signed, err := signDoc(draft, map[string]secretKey{*keyid: k})
	if err != nil {
		return err
	}
	fmt.Fprintf(c.out, "%s продлён до %s\n", filepath.Base(*out), expiresAt(time.Now(), *ttl))
	return writeFile(*out, append(signed, '\n'), 0o644)
}

// expiry печатает сроки манифестов и sources каталога и завершается ошибкой,
// если какой-то истекает в пределах окна -within: cron meta-refresh после
// переподписи timestamp падает с этим сообщением за 14 суток до истечения.
func (c *cli) expiry(args []string) error {
	fs := flag.NewFlagSet("expiry", flag.ContinueOnError)
	fs.SetOutput(c.errw)
	dir := fs.String("dir", "", "каталог meta/")
	within := fs.Duration("within", 14*24*time.Hour, "окно предупреждения")
	if err := fs.Parse(args); err != nil {
		return err
	}
	files, _ := filepath.Glob(filepath.Join(*dir, "manifest-*.json"))
	if src := filepath.Join(*dir, "sources.json"); *dir != "" {
		if _, err := os.Stat(src); err == nil {
			files = append(files, src)
		}
	}
	if len(files) == 0 {
		return fmt.Errorf("в %q нет manifest-*.json и sources.json", *dir)
	}
	sort.Strings(files)
	var soon []string
	for _, f := range files {
		exp, err := signedExpiry(f)
		if err != nil {
			return fmt.Errorf("%s: %w", f, err)
		}
		left := time.Until(exp).Round(time.Hour)
		fmt.Fprintf(c.out, "%s истекает %s (через %s)\n", filepath.Base(f), exp.UTC().Format(time.RFC3339), left)
		if time.Until(exp) < *within {
			soon = append(soon, filepath.Base(f))
		}
	}
	if len(soon) > 0 {
		return fmt.Errorf("истекает в пределах %s: %s — выпустите релиз или запустите ручной workflow meta-resign (Environment release-signing)",
			*within, strings.Join(soon, ", "))
	}
	return nil
}

func signedExpiry(path string) (time.Time, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return time.Time{}, err
	}
	env, err := updates.ParseEnvelope(raw)
	if err != nil {
		return time.Time{}, err
	}
	var doc struct {
		Expires time.Time `json:"expires"`
	}
	if err := json.Unmarshal(env.Signed, &doc); err != nil {
		return time.Time{}, err
	}
	return doc.Expires, nil
}
