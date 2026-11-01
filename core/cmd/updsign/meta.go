// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// multiFlag — повторяемый флаг (-key a=... -key b=...).
type multiFlag []string

func (m *multiFlag) String() string     { return strings.Join(*m, ",") }
func (m *multiFlag) Set(v string) error { *m = append(*m, v); return nil }

// root подписывает root.json ключами root: при выпуске v1 — одним (k1), при
// ротации — ключами предыдущего корня и нового. С -prev результат проверяется
// как ротация относительно прежнего корня.
func (c *cli) root(args []string) error {
	fs := flag.NewFlagSet("root", flag.ContinueOnError)
	fs.SetOutput(c.errw)
	var keys multiFlag
	fs.Var(&keys, "key", "ID=file:ПУТЬ|env:ИМЯ (повторяется)")
	in := fs.String("in", "", "черновик подписываемой части root")
	out := fs.String("out", "", "куда записать root.json")
	prev := fs.String("prev", "", "прежний root.json (проверка ротации)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *in == "" || *out == "" || len(keys) == 0 {
		return errors.New("нужны -in, -out и хотя бы один -key ID=…")
	}
	set := map[string]secretKey{}
	for _, spec := range keys {
		id, src, ok := strings.Cut(spec, "=")
		if !ok || id == "" {
			return fmt.Errorf("ключ root задаётся как ID=file:ПУТЬ, получено %q", spec)
		}
		k, err := c.loadKey(src)
		if err != nil {
			return err
		}
		set[id] = k
	}
	env, err := readAndSign(*in, *out, set)
	if err != nil {
		return err
	}
	if err := checkRoot(env, *prev); err != nil {
		_ = os.Remove(*out)
		return err
	}
	fmt.Fprintf(c.out, "root.json записан в %s\n", *out)
	return nil
}

func checkRoot(env []byte, prevPath string) error {
	if prevPath == "" {
		_, err := updates.NewTrust(env)
		return err
	}
	raw, err := os.ReadFile(prevPath)
	if err != nil {
		return err
	}
	prev, err := updates.NewTrust(raw)
	if err != nil {
		return fmt.Errorf("прежний root: %w", err)
	}
	_, err = prev.VerifyRootUpdate(env)
	return err
}

// singleKey — общий для sources/timestamp/manifest разбор ключа подписи.
func (c *cli) singleKey(spec string) (secretKey, error) {
	if spec == "" {
		return secretKey{}, errors.New("нужен -key file:ПУТЬ|env:ИМЯ")
	}
	return c.loadKey(spec)
}

// sources подписывает sources.json ключом роли sources (r1). Если в черновике
// нет expires, ставится now+срок.
func (c *cli) sources(args []string) error {
	fs := flag.NewFlagSet("sources", flag.ContinueOnError)
	fs.SetOutput(c.errw)
	key, keyid := fs.String("key", "", "ключ r1"), fs.String("keyid", "r1", "keyid в root.json")
	in, out := fs.String("in", "", "черновик"), fs.String("out", "", "sources.json")
	ttl := fs.Duration("expires", 90*24*time.Hour, "срок действия, если не задан в черновике")
	if err := fs.Parse(args); err != nil {
		return err
	}
	k, err := c.singleKey(*key)
	if err != nil || *in == "" || *out == "" {
		return errors.Join(err, errors.New("нужны -key, -in и -out"))
	}
	draft, err := os.ReadFile(*in)
	if err != nil {
		return err
	}
	if draft, err = withDefault(draft, "expires", expiresAt(time.Now(), *ttl)); err != nil {
		return err
	}
	env, err := signDoc(draft, map[string]secretKey{*keyid: k})
	if err != nil {
		return err
	}
	if _, err := parseSignedSources(env); err != nil {
		return err
	}
	fmt.Fprintf(c.out, "sources.json записан в %s\n", *out)
	return writeFile(*out, append(env, '\n'), 0o644)
}

// timestamp собирает timestamp.json по manifest-*.json каталога: версия —
// монотонная (по умолчанию unix-время), срок — 7 суток.
func (c *cli) timestamp(args []string) error {
	fs := flag.NewFlagSet("timestamp", flag.ContinueOnError)
	fs.SetOutput(c.errw)
	key, keyid := fs.String("key", "", "ключ t1"), fs.String("keyid", "t1", "keyid в root.json")
	dir, out := fs.String("dir", "", "каталог с manifest-*.json"), fs.String("out", "", "timestamp.json")
	ttl := fs.Duration("expires", 7*24*time.Hour, "срок действия")
	ver := fs.Int64("version", 0, "версия (0 — текущее unix-время)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	k, err := c.singleKey(*key)
	if err != nil || *dir == "" || *out == "" {
		return errors.Join(err, errors.New("нужны -key, -dir и -out"))
	}
	now := time.Now()
	if *ver == 0 {
		*ver = now.Unix()
	}
	meta, err := manifestEntries(*dir)
	if err != nil {
		return err
	}
	doc, _ := marshalPlain(map[string]any{"type": "timestamp", "version": *ver, "expires": expiresAt(now, *ttl), "meta": meta})
	env, err := signDoc(doc, map[string]secretKey{*keyid: k})
	if err != nil {
		return err
	}
	fmt.Fprintf(c.out, "timestamp.json (версия %d) записан в %s\n", *ver, *out)
	return writeFile(*out, append(env, '\n'), 0o644)
}

// manifestEntries — запись timestamp.meta для каждого manifest-*.json.
func manifestEntries(dir string) (map[string]updates.TimestampEntry, error) {
	files, _ := filepath.Glob(filepath.Join(dir, "manifest-*.json"))
	if len(files) == 0 {
		return nil, fmt.Errorf("в %s нет manifest-*.json", dir)
	}
	meta := map[string]updates.TimestampEntry{}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			return nil, err
		}
		env, err := updates.ParseEnvelope(raw)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f, err)
		}
		mf, err := updates.ParseManifest(env.Signed)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f, err)
		}
		sum := sha256.Sum256(env.Signed)
		meta[filepath.Base(f)] = updates.TimestampEntry{Serial: mf.Serial, Sha256: hex.EncodeToString(sum[:]), Length: int64(len(env.Signed))}
	}
	return meta, nil
}
