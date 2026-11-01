// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// secretKey — приватный ключ роли. В файле: комментарий и одна строка base64
// «LS + keyid(8) + seed(32)»; keyid нужен minisign-ключам, остальным безвреден.
type secretKey struct {
	role  string
	keyID [8]byte
	priv  ed25519.PrivateKey
}

const (
	secretComment = "untrusted comment: lavray updsign secret key"
	secretMagic   = "LS"
)

var roles = map[string]bool{"root": true, "timestamp": true, "manifest": true, "artifact": true}

func newSecretKey(role string) (secretKey, error) {
	seed := make([]byte, ed25519.SeedSize)
	k := secretKey{role: role}
	if _, err := rand.Read(seed); err != nil {
		return k, err
	}
	if _, err := rand.Read(k.keyID[:]); err != nil {
		return k, err
	}
	k.priv = ed25519.NewKeyFromSeed(seed)
	return k, nil
}

func (k secretKey) encode() []byte {
	blob := append(append([]byte(secretMagic), k.keyID[:]...), k.priv.Seed()...)
	return []byte(secretComment + " (" + k.role + ")\n" + base64.StdEncoding.EncodeToString(blob) + "\n")
}

func parseSecret(text string) (secretKey, error) {
	lines := strings.Fields(strings.ReplaceAll(text, "\r", ""))
	last := ""
	if len(lines) > 0 {
		last = lines[len(lines)-1]
	}
	blob, err := base64.StdEncoding.DecodeString(last)
	if err != nil || len(blob) != 2+8+ed25519.SeedSize || string(blob[:2]) != secretMagic {
		return secretKey{}, errors.New("ключ не распознан (ожидается файл updsign genkey)")
	}
	k := secretKey{priv: ed25519.NewKeyFromSeed(blob[10:])}
	copy(k.keyID[:], blob[2:10])
	return k, nil
}

// loadKey читает ключ из file:ПУТЬ или env:ИМЯ. Файл внутри git-дерева — отказ.
func (c *cli) loadKey(spec string) (secretKey, error) {
	switch {
	case strings.HasPrefix(spec, "file:"):
		path := strings.TrimPrefix(spec, "file:")
		if err := refuseInGitTree(path); err != nil {
			return secretKey{}, err
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return secretKey{}, fmt.Errorf("ключ %s: %w", path, err)
		}
		return parseSecret(string(raw))
	case strings.HasPrefix(spec, "env:"):
		name := strings.TrimPrefix(spec, "env:")
		if v := c.getenv(name); v != "" {
			return parseSecret(v)
		}
		return secretKey{}, fmt.Errorf("переменная окружения %s пуста", name)
	}
	return secretKey{}, fmt.Errorf("ключ задаётся как file:ПУТЬ или env:ИМЯ, получено %q", spec)
}

// refuseInGitTree: ключ нельзя хранить и читать внутри рабочего дерева git —
// его легко закоммитить случайно.
func refuseInGitTree(path string) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	for dir := filepath.Dir(abs); ; dir = filepath.Dir(dir) {
		if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
			return fmt.Errorf("файл ключа %s лежит внутри git-дерева (%s): храните ключи вне репозитория", filepath.Base(path), dir)
		}
		if filepath.Dir(dir) == dir {
			return nil
		}
	}
}

// genkey создаёт ключ роли; на stdout — только публичная часть.
func (c *cli) genkey(args []string) error {
	fs := flag.NewFlagSet("genkey", flag.ContinueOnError)
	fs.SetOutput(c.errw)
	role := fs.String("role", "", "root|timestamp|manifest|artifact")
	out := fs.String("out", "", "куда записать приватный ключ (вне git-дерева)")
	pubOut := fs.String("pub", "", "куда записать публичную часть (JSON)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if !roles[*role] || *out == "" {
		return errors.New("нужны -role (root|timestamp|manifest|artifact) и -out")
	}
	if err := refuseInGitTree(*out); err != nil {
		return err
	}
	k, err := newSecretKey(*role)
	if err != nil {
		return err
	}
	if _, err := os.Stat(*out); err == nil {
		return fmt.Errorf("%s уже существует: ключ не перезаписывается", *out)
	}
	if err := writeFile(*out, k.encode(), 0o600); err != nil {
		return err
	}
	pub, _ := json.MarshalIndent(k.publicInfo(), "", "  ")
	if *pubOut != "" {
		if err := writeFile(*pubOut, append(pub, '\n'), 0o644); err != nil {
			return err
		}
	}
	fmt.Fprintf(c.out, "ключ роли %s записан в %s (права 0600)\nпубличная часть:\n%s\n", *role, *out, pub)
	return nil
}

// publicInfo — то, что кладут в root.json и публикуют.
func (k secretKey) publicInfo() map[string]any {
	pub := k.priv.Public().(ed25519.PublicKey)
	if k.role == "artifact" {
		mk := updates.MinisignKey{KeyID: k.keyID, Pub: pub}
		return map[string]any{"role": k.role, "root_key": map[string]string{"alg": "minisign", "pub": mk.Base64()},
			"minisign_pub": mk.Base64()}
	}
	return map[string]any{"role": k.role, "root_key": map[string]string{"alg": "ed25519", "pub": base64.StdEncoding.EncodeToString(pub)}}
}

func writeFile(path string, data []byte, mode os.FileMode) error {
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return os.WriteFile(path, data, mode)
}
