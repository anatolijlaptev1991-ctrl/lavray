// SPDX-License-Identifier: GPL-3.0-only

// verify_artifact.go — подкоманда `lavray-core verify-artifact`: проверка
// установщика по подписи minisign. Оболочка запускает ЕЁ (из каталога установки,
// не из staging и не из каталога данных) перед повышением прав: сама оболочка
// подписи не знает и не должна верить ни сумме, ни версии от страницы.
//
//	lavray-core verify-artifact --file F --sig F.minisig [--data DIR] [--allow-older]
//
// Ключ роли artifact берётся из цепочки корней, начинающейся с ВШИТОГО в сборку
// корня (принятые ротации лежат в <data>/updates/roots и перепроверяются
// от вшитого). Проверяются подпись, trusted comment (продукт, платформа) и
// версия: новее установленной, а для отката (--allow-older) — любая подписанная.
// Успех: код 0 и JSON {"version","sha256"} в stdout; любой отказ — код 1.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/version"
)

func runVerifyArtifact(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("verify-artifact", flag.ContinueOnError)
	fs.SetOutput(stderr)
	file := fs.String("file", "", "установщик")
	sig := fs.String("sig", "", "файл подписи minisign")
	data := fs.String("data", defaultDataDir(), "каталог данных (там updates/roots)")
	older := fs.Bool("allow-older", false, "разрешить версию не новее установленной (откат)")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if *file == "" || *sig == "" {
		fmt.Fprintln(stderr, "verify-artifact: нужны --file и --sig")
		return 2
	}
	res, err := verifyArtifact(*file, *sig, *data, *older)
	if err != nil {
		fmt.Fprintln(stderr, "verify-artifact:", err)
		return 1
	}
	out, _ := json.Marshal(map[string]string{"version": res.Claims.Version, "sha256": res.Sha256})
	fmt.Fprintln(stdout, string(out))
	return 0
}

func verifyArtifact(file, sig, data string, allowOlder bool) (updates.LocalResult, error) {
	root := trustRootJSON()
	if root == nil {
		return updates.LocalResult{}, fmt.Errorf("updates not configured (no trust root in this build)")
	}
	store := updates.DirRootStore{Dir: filepath.Join(data, "updates", "roots")}
	trust, err := updates.ResolveTrust(root, store)
	if err != nil {
		return updates.LocalResult{}, err
	}
	pol := updates.LocalPolicy{Product: updateProduct(), Platform: updates.CurrentAssetKey(),
		AppVersion: strings.TrimSpace(version.Version), AllowOlder: allowOlder}
	return updates.VerifyInstallerFile(trust, file, sig, pol)
}
