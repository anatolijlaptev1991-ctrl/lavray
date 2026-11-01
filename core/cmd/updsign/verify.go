// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// dirSource — каталог как источник метаданных и артефактов: проверка идёт тем
// же кодом, что и в клиенте, только вместо сети читаются файлы.
type dirSource struct {
	dir  string
	flat bool // артефакты ищутся по имени файла (каталог dist), а не по пути манифеста
}

func (d dirSource) file(name string) string {
	if d.flat {
		name = path.Base(name)
	}
	return filepath.Join(d.dir, filepath.FromSlash(name))
}

func (d dirSource) Fetch(_ context.Context, name string) ([]byte, error) {
	b, err := os.ReadFile(d.file(name))
	if os.IsNotExist(err) {
		return nil, fmt.Errorf("%w: %s", updates.ErrNotFound, name)
	}
	return b, err
}

func (d dirSource) Open(_ context.Context, name string, off int64) (*updates.ArtifactStream, error) {
	b, err := d.Fetch(context.Background(), name)
	if err != nil {
		return nil, err
	}
	return &updates.ArtifactStream{Body: io.NopCloser(bytes.NewReader(b[off:])), Start: off, Total: int64(len(b))}, nil
}

// verify проверяет каталог meta/ так же, как клиент: цепочка корней, timestamp
// (подпись, срок ≤ 7 суток), манифесты по пину timestamp, продукт, срок;
// с -assets — ещё и установщики (sha256, длина, minisign).
func (c *cli) verify(args []string) error {
	fs := flag.NewFlagSet("verify", flag.ContinueOnError)
	fs.SetOutput(c.errw)
	rootPath, dir := fs.String("root", "", "root.json"), fs.String("dir", "", "каталог meta/")
	assets, product := fs.String("assets", "", "каталог с установщиками"), fs.String("product", "", "ожидаемый продукт")
	nowFlag := fs.String("now", "", "момент проверки RFC3339 (по умолчанию сейчас)")
	only := fs.String("channel", "", "проверить только этот канал (выпускаемый)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *rootPath == "" || *dir == "" {
		return errors.New("нужны -root и -dir")
	}
	raw, err := os.ReadFile(*rootPath)
	if err != nil {
		return err
	}
	trust, err := updates.NewTrust(raw)
	if err != nil {
		return fmt.Errorf("root.json: %w", err)
	}
	now := time.Now()
	if *nowFlag != "" {
		if now, err = time.Parse(time.RFC3339, *nowFlag); err != nil {
			return fmt.Errorf("-now: %w", err)
		}
	}
	files, _ := filepath.Glob(filepath.Join(*dir, "manifest-*.json"))
	if *only != "" { // просроченный манифест соседнего канала не мешает выпуску этого
		files = []string{filepath.Join(*dir, updates.ManifestName(*only))}
		if _, err := os.Stat(files[0]); err != nil {
			return fmt.Errorf("нет манифеста канала %q: %w", *only, err)
		}
	}
	sort.Strings(files)
	if len(files) == 0 {
		return fmt.Errorf("в %s нет manifest-*.json", *dir)
	}
	var failed []string
	for _, f := range files {
		ch := strings.TrimSuffix(strings.TrimPrefix(filepath.Base(f), "manifest-"), ".json")
		if err := c.verifyChannel(trust, dirSource{dir: *dir}, ch, *product, *assets, now); err != nil {
			failed = append(failed, fmt.Sprintf("%s: %v", ch, err))
		}
	}
	if len(failed) > 0 {
		return fmt.Errorf("проверка не пройдена:\n  %s", strings.Join(failed, "\n  "))
	}
	fmt.Fprintln(c.out, "ok")
	return nil
}

func (c *cli) verifyChannel(trust *updates.Trust, src dirSource, channel, product, assetsDir string, now time.Time) error {
	cl := &updates.Client{Trust: trust, Product: product, AppVersion: "0.0.0", Channel: channel,
		BootstrapSources: []updates.Source{src}, State: &updates.State{}, Now: func() time.Time { return now },
		PhaseTimeout: 10 * time.Second}
	res, err := cl.Check(context.Background())
	if err != nil {
		return err
	}
	if res.Manifest == nil || res.Manifest.App == nil {
		return errors.New("в манифесте нет секции app")
	}
	mf := res.Manifest
	fmt.Fprintf(c.out, "ok  root v%d, timestamp v%d, manifest-%s serial %d, версия %s\n",
		res.Trust.Root().Version, res.Timestamp.Version, channel, mf.Serial, mf.App.Version)
	for key := range mf.App.Assets {
		if err := c.verifyAsset(res, key, assetsDir); err != nil {
			return fmt.Errorf("актив %s: %w", key, err)
		}
	}
	return nil
}

// verifyAsset: без каталога установщиков проверяется только разбор подписи и
// заявления; с каталогом — файл целиком.
func (c *cli) verifyAsset(res *updates.Result, key, assetsDir string) error {
	asset := res.Manifest.App.Assets[key]
	sig, err := updates.ParseMinisig([]byte(asset.Minisig))
	if err != nil {
		return err
	}
	want := updates.ArtifactClaims{Product: res.Manifest.Product, Platform: key, Channel: res.Manifest.Channel,
		Version: res.Manifest.App.Version, Serial: res.Manifest.Serial}
	if err := sig.CheckClaims(want); err != nil {
		return err
	}
	if assetsDir == "" {
		fmt.Fprintf(c.out, "ok  актив %s: подпись разобрана, файл не проверен (нет -assets)\n", key)
		return nil
	}
	local := *res
	local.AssetKey = key
	verify, err := local.ArtifactVerifierFor(asset)
	if err != nil {
		return err
	}
	tmp, err := os.MkdirTemp("", "updsign-verify-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	dl := &updates.Downloader{Sources: []updates.ArtifactSource{dirSource{dir: assetsDir, flat: true}}, Dir: tmp, Verify: verify}
	if _, err := dl.Fetch(context.Background(), asset); err != nil {
		return err
	}
	fmt.Fprintf(c.out, "ok  актив %s: sha256, длина и minisign сошлись\n", key)
	return nil
}
