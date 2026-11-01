// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// verifyRole — частичная проверка каталога. Сейчас единственная роль — timestamp:
// цепочка корней, подпись и срок timestamp.json и то, что закреплённые им
// манифесты лежат без изменений (sha256 и длина подписанной части). Сами
// манифесты (срок, продукт, активы) НЕ проверяются: ночное продление timestamp
// не должно зависеть от просроченного манифеста соседнего канала.
func (c *cli) verifyRole(trust *updates.Trust, role, channel, dir string, now time.Time) error {
	if role != updates.RoleTimestamp {
		return fmt.Errorf("-role: поддерживается только %q, получено %q", updates.RoleTimestamp, role)
	}
	if channel != "" {
		return errors.New("-role и -channel вместе не используются")
	}
	ctx := context.Background()
	src := dirSource{dir: dir}
	srcs := []updates.Source{src}
	trust, _, err := updates.AdvanceRootWith(ctx, srcs, trust, now, updates.QueryPolicy{Timeout: 10 * time.Second})
	if err != nil {
		return err
	}
	res, err := updates.FetchTimestamp(ctx, trust, srcs, updates.TimestampPolicy{Now: now, Timeout: 10 * time.Second})
	if err != nil {
		return err
	}
	if err := checkPins(dir, res.Timestamp); err != nil {
		return err
	}
	fmt.Fprintf(c.out, "ok  root v%d, timestamp v%d (до %s), закреплено манифестов: %d\nok\n",
		trust.Root().Version, res.Timestamp.Version, res.Timestamp.Expires.UTC().Format(time.RFC3339), len(res.Timestamp.Meta))
	return nil
}

// checkPins сверяет каждый закреплённый manifest-*.json с записью timestamp.
func checkPins(dir string, ts *updates.Timestamp) error {
	names := make([]string, 0, len(ts.Meta))
	for name := range ts.Meta {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		env, err := updates.ParseEnvelope(raw)
		if err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		sum := sha256.Sum256(env.Signed)
		pin := ts.Meta[name]
		if hex.EncodeToString(sum[:]) != pin.Sha256 || int64(len(env.Signed)) != pin.Length {
			return fmt.Errorf("%s: файл не совпал с записью timestamp (sha256 или длина)", name)
		}
	}
	return nil
}
