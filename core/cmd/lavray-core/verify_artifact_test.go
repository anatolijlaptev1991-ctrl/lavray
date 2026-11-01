// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates/updatestest"
)

type artifactRig struct {
	t    *testing.T
	env  *updatestest.Env
	exe  string
	dir  string
	data string
}

func newArtifactRig(t *testing.T) *artifactRig {
	t.Helper()
	env := updatestest.New(t)
	env.Product = "lavray-" + runtime.GOOS
	root := base64.StdEncoding.EncodeToString(env.RootJSON)
	exe := buildCoreFlags(t, "-X main.rootJSONB64="+root+" -X "+versionPkg+".Version=0.5.0")
	return &artifactRig{t: t, env: env, exe: exe, dir: t.TempDir(), data: t.TempDir()}
}

// file кладёт установщик; sign == "" — без подписи, иначе подписано ключом env.
func (r *artifactRig) file(name string, data []byte, version string, sign bool) (installer, sig string) {
	installer = filepath.Join(r.dir, name)
	if err := os.WriteFile(installer, data, 0o600); err != nil {
		r.t.Fatal(err)
	}
	sig = installer + ".minisig"
	if sign {
		claims := updates.ArtifactClaims{Product: r.env.Product, Platform: updates.CurrentAssetKey(), Channel: "stable", Version: version, Serial: 3}
		text := updates.SignMinisigPrehashed(r.env.Art, r.env.ArtID, updates.DigestOf(data), claims.String())
		if err := os.WriteFile(sig, text, 0o600); err != nil {
			r.t.Fatal(err)
		}
	}
	return installer, sig
}

func (r *artifactRig) run(args ...string) (int, string, string) {
	r.t.Helper()
	cmd := exec.Command(r.exe, append([]string{"verify-artifact", "--data", r.data}, args...)...)
	var out, errw bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errw
	err := cmd.Run()
	code := 0
	if ee, ok := err.(*exec.ExitError); ok {
		code = ee.ExitCode()
	} else if err != nil {
		r.t.Fatal(err)
	}
	return code, out.String(), errw.String()
}

func TestVerifyArtifactSubcommand(t *testing.T) {
	r := newArtifactRig(t)
	data := []byte("installer-0.6.0")

	inst, sig := r.file("ok.exe", data, "0.6.0", true)
	code, out, errw := r.run("--file", inst, "--sig", sig)
	var res struct{ Version, Sha256 string }
	if code != 0 || json.Unmarshal([]byte(out), &res) != nil || res.Version != "0.6.0" || len(res.Sha256) != 64 {
		t.Fatalf("валидный установщик: код %d, stdout=%q stderr=%q", code, out, errw)
	}

	t.Run("без подписи", func(t *testing.T) {
		inst, sig := r.file("unsigned.exe", data, "0.6.0", false)
		if code, out, _ := r.run("--file", inst, "--sig", sig); code == 0 || out != "" {
			t.Fatalf("файл без подписи принят: код %d %q", code, out)
		}
	})
	t.Run("подпись чужого ключа", func(t *testing.T) {
		inst, sig := r.file("foreign.exe", data, "0.6.0", false)
		other := updatestest.New(t)
		claims := updates.ArtifactClaims{Product: r.env.Product, Platform: updates.CurrentAssetKey(), Channel: "stable", Version: "0.6.0", Serial: 3}
		_ = os.WriteFile(sig, updates.SignMinisigPrehashed(other.Art, other.ArtID, updates.DigestOf(data), claims.String()), 0o600)
		if code, _, _ := r.run("--file", inst, "--sig", sig); code == 0 {
			t.Fatal("подпись ключа, которого нет в корне сборки, принята")
		}
	})
	t.Run("подмена содержимого", func(t *testing.T) {
		inst, sig := r.file("tampered.exe", data, "0.6.0", true)
		_ = os.WriteFile(inst, []byte("installer-0.6.X"), 0o600)
		if code, _, _ := r.run("--file", inst, "--sig", sig); code == 0 {
			t.Fatal("измённый после подписи файл принят")
		}
	})
	t.Run("версия не новее", func(t *testing.T) {
		inst, sig := r.file("old.exe", data, "0.4.0", true)
		if code, _, _ := r.run("--file", inst, "--sig", sig); code == 0 {
			t.Fatal("старая версия принята без --allow-older")
		}
		code, out, _ := r.run("--file", inst, "--sig", sig, "--allow-older")
		if code != 0 || !strings.Contains(out, `"0.4.0"`) {
			t.Fatalf("--allow-older для отката: код %d %q", code, out)
		}
	})
	t.Run("огромная подпись и мусор", func(t *testing.T) {
		inst, sig := r.file("big.exe", data, "0.6.0", false)
		_ = os.WriteFile(sig, bytes.Repeat([]byte("a"), 10_000), 0o600)
		if code, _, _ := r.run("--file", inst, "--sig", sig); code == 0 {
			t.Fatal("огромный .minisig принят")
		}
		if code, _, _ := r.run("--file", filepath.Join(r.dir, "нет.exe"), "--sig", sig); code == 0 {
			t.Fatal("несуществующий файл принят")
		}
		if code, _, _ := r.run(); code == 0 {
			t.Fatal("без аргументов должна быть ошибка")
		}
	})
	t.Run("подложенные корни не помогают", func(t *testing.T) {
		rootsDir := filepath.Join(r.data, "updates", "roots")
		_ = os.MkdirAll(rootsDir, 0o700)
		forged := updatestest.New(t)
		_ = os.WriteFile(filepath.Join(rootsDir, "2.root.json"), forged.RootJSON, 0o600)
		inst, sig := r.file("forged.exe", data, "0.6.0", false)
		claims := updates.ArtifactClaims{Product: r.env.Product, Platform: updates.CurrentAssetKey(), Channel: "stable", Version: "0.6.0", Serial: 3}
		_ = os.WriteFile(sig, updates.SignMinisigPrehashed(forged.Art, forged.ArtID, updates.DigestOf(data), claims.String()), 0o600)
		if code, _, _ := r.run("--file", inst, "--sig", sig); code == 0 {
			t.Fatal("корень, подложенный в каталог данных, принят")
		}
	})
}

// В сборке без корня доверия проверять нечем — отказ, а не «всё в порядке».
func TestVerifyArtifactWithoutTrustRootFails(t *testing.T) {
	exe := buildCoreFlags(t, "")
	cmd := exec.Command(exe, "verify-artifact", "--file", "a", "--sig", "b", "--data", t.TempDir())
	var errw bytes.Buffer
	cmd.Stderr = &errw
	if err := cmd.Run(); err == nil || !strings.Contains(errw.String(), "not configured") {
		t.Fatalf("сборка с заглушкой: err=%v stderr=%q", err, errw.String())
	}
}
