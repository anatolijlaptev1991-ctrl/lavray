// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// signArtifact — подпись minisign (prehashed ED, BLAKE2b-512) с trusted comment
// «product;platform;channel;version;serial».
func signArtifact(k secretKey, data []byte, claims updates.ArtifactClaims) []byte {
	return updates.SignMinisigPrehashed(k.priv, k.keyID, updates.DigestOf(data), claims.String())
}

// artifact подписывает один файл и пишет <файл>.minisig: подпись кладут рядом с
// установщиком в релиз и используют для «Установить из файла» без сети.
func (c *cli) artifact(args []string) error {
	fs := flag.NewFlagSet("artifact", flag.ContinueOnError)
	fs.SetOutput(c.errw)
	key, file := fs.String("key", "", "ключ a1"), fs.String("file", "", "подписываемый файл")
	product, platform := fs.String("product", "", ""), fs.String("platform", "windows-x64", "")
	channel, version := fs.String("channel", "stable", ""), fs.String("version", "", "")
	serial := fs.Int64("serial", 0, "serial манифеста")
	out := fs.String("out", "", "куда записать (по умолчанию <файл>.minisig)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *file == "" || *product == "" || *version == "" || *serial < 1 {
		return errors.New("нужны -file, -product, -version и -serial ≥ 1")
	}
	k, err := c.singleKey(*key)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(*file)
	if err != nil {
		return err
	}
	if *out == "" {
		*out = *file + updates.MinisigSuffix
	}
	claims := updates.ArtifactClaims{Product: *product, Platform: *platform, Channel: *channel, Version: *version, Serial: *serial}
	if err := writeFile(*out, signArtifact(k, data, claims), 0o644); err != nil {
		return err
	}
	fmt.Fprintf(c.out, "подпись записана в %s\n", *out)
	return nil
}
