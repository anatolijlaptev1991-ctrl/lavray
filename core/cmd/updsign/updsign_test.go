// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// harness: временный каталог вне git, ключи четырёх ролей, подписанный root.
type harness struct {
	t    *testing.T
	dir  string
	env  map[string]string
	root string
}

func (h *harness) run(args ...string) (int, string, string) {
	h.t.Helper()
	var out, errw bytes.Buffer
	code := run(args, &out, &errw, func(k string) string { return h.env[k] })
	return code, out.String(), errw.String()
}

func (h *harness) must(args ...string) string {
	h.t.Helper()
	code, out, errw := h.run(args...)
	if code != 0 {
		h.t.Fatalf("updsign %v: код %d\n%s%s", args, code, out, errw)
	}
	return out
}

func (h *harness) p(name string) string { return filepath.Join(h.dir, name) }

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{t: t, dir: t.TempDir(), env: map[string]string{}}
	pubs := map[string]map[string]any{}
	for role, id := range map[string]string{"root": "k1", "timestamp": "t1", "manifest": "r1", "artifact": "a1"} {
		h.must("genkey", "-role", role, "-out", h.p(role+".sec"), "-pub", h.p(role+".pub.json"))
		var pub struct {
			RootKey map[string]string `json:"root_key"`
		}
		raw, _ := os.ReadFile(h.p(role + ".pub.json"))
		if err := json.Unmarshal(raw, &pub); err != nil {
			t.Fatal(err)
		}
		pubs[id] = map[string]any{"alg": pub.RootKey["alg"], "pub": pub.RootKey["pub"]}
	}
	role := func(id string) map[string]any { return map[string]any{"keyids": []string{id}, "threshold": 1} }
	draft, _ := json.Marshal(map[string]any{"type": "root", "version": 1,
		"expires": time.Now().Add(2 * 365 * 24 * time.Hour).UTC().Format(time.RFC3339), "keys": pubs,
		"roles": map[string]any{"root": role("k1"), "timestamp": role("t1"), "manifest": role("r1"),
			"sources": role("r1"), "artifact": role("a1")}})
	_ = os.WriteFile(h.p("root-draft.json"), draft, 0o644)
	h.root = h.p("meta/root.json")
	h.must("root", "-key", "k1=file:"+h.p("root.sec"), "-in", h.p("root-draft.json"), "-out", h.root)
	return h
}

func (h *harness) release(version, channel string, installer []byte) {
	h.t.Helper()
	file := h.p("dist/LAVRay-" + version + "-x64-setup.exe")
	_ = os.MkdirAll(h.p("dist"), 0o755)
	_ = os.WriteFile(file, installer, 0o644)
	h.must("manifest", "-key", "file:"+h.p("manifest.sec"), "-artifact-key", "file:"+h.p("artifact.sec"),
		"-product", "lavray-windows", "-channel", channel, "-version", version, "-serial", "7",
		"-asset", "windows-x64=v"+version+"/LAVRay-"+version+"-x64-setup.exe="+file,
		"-out", h.p("meta/manifest-"+channel+".json"))
	h.must("timestamp", "-key", "file:"+h.p("timestamp.sec"), "-dir", h.p("meta"), "-out", h.p("meta/timestamp.json"))
}

func TestGenkeySignVerifyRoundTrip(t *testing.T) {
	h := newHarness(t)
	h.release("0.5.1", "stable", []byte("installer-bytes-0.5.1"))
	out := h.must("verify", "-root", h.root, "-dir", h.p("meta"), "-assets", h.p("dist"), "-product", "lavray-windows")
	if !strings.Contains(out, "minisign сошлись") || !strings.HasSuffix(strings.TrimSpace(out), "ok") {
		t.Fatalf("verify: %s", out)
	}
	// без каталога установщиков проверяется всё, кроме самого файла
	if out = h.must("verify", "-root", h.root, "-dir", h.p("meta")); !strings.Contains(out, "файл не проверен") {
		t.Fatalf("verify без -assets: %s", out)
	}
}

func TestVerifyDetectsTampering(t *testing.T) {
	h := newHarness(t)
	h.release("0.5.1", "stable", []byte("installer-bytes-0.5.1"))
	_ = os.WriteFile(h.p("dist/LAVRay-0.5.1-x64-setup.exe"), []byte("installer-bytes-0.5.X"), 0o644)
	if code, _, errw := h.run("verify", "-root", h.root, "-dir", h.p("meta"), "-assets", h.p("dist")); code == 0 || !strings.Contains(errw, "sha256") {
		t.Fatalf("подменённый установщик: код %d %s", code, errw)
	}
	_ = os.WriteFile(h.p("dist/LAVRay-0.5.1-x64-setup.exe"), []byte("installer-bytes-0.5.1"), 0o644)
	if code, _, _ := h.run("verify", "-root", h.root, "-dir", h.p("meta"), "-product", "lavray-linux"); code == 0 {
		t.Fatal("чужой продукт должен отвергаться")
	}
	late := time.Now().Add(9 * 24 * time.Hour).UTC().Format(time.RFC3339)
	if code, _, errw := h.run("verify", "-root", h.root, "-dir", h.p("meta"), "-now", late); code == 0 || !strings.Contains(errw, "просрочен") {
		t.Fatalf("просроченный timestamp: код %d %s", code, errw)
	}
	raw, _ := os.ReadFile(h.p("meta/manifest-stable.json"))
	_ = os.WriteFile(h.p("meta/manifest-stable.json"), bytes.Replace(raw, []byte(`"serial":7`), []byte(`"serial":8`), 1), 0o644)
	if code, _, _ := h.run("verify", "-root", h.root, "-dir", h.p("meta")); code == 0 {
		t.Fatal("правка подписанного манифеста должна ломать проверку")
	}
}

func TestRefusesKeyInsideRepo(t *testing.T) {
	h := newHarness(t)
	repo := t.TempDir()
	if err := os.Mkdir(filepath.Join(repo, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(repo, "keys", "k.sec")
	if code, _, errw := h.run("genkey", "-role", "root", "-out", target); code == 0 || !strings.Contains(errw, "git-дерева") {
		t.Fatalf("genkey внутри репозитория: код %d %s", code, errw)
	}
	if _, err := os.Stat(target); err == nil {
		t.Fatal("файл ключа создан внутри репозитория")
	}
	// ключ, уже лежащий в репозитории, тоже не читается
	raw, _ := os.ReadFile(h.p("root.sec"))
	inRepo := filepath.Join(repo, "root.sec")
	_ = os.WriteFile(inRepo, raw, 0o600)
	if code, _, errw := h.run("sources", "-key", "file:"+inRepo, "-in", h.p("root-draft.json"), "-out", h.p("s.json")); code == 0 || !strings.Contains(errw, "git-дерева") {
		t.Fatalf("чтение ключа из репозитория: код %d %s", code, errw)
	}
}

func TestTimestampExpiresDefault7d(t *testing.T) {
	h := newHarness(t)
	h.release("0.5.1", "stable", []byte("x"))
	raw, _ := os.ReadFile(h.p("meta/timestamp.json"))
	env, err := updates.ParseEnvelope(raw)
	if err != nil {
		t.Fatal(err)
	}
	ts, err := updates.ParseTimestamp(env.Signed)
	if err != nil {
		t.Fatal(err)
	}
	if d := time.Until(ts.Expires) - 7*24*time.Hour; d > time.Minute || d < -time.Minute {
		t.Fatalf("срок timestamp по умолчанию ≈ 7 суток, расхождение %v", d)
	}
	if ts.Version < time.Now().Add(-time.Minute).Unix() {
		t.Fatalf("версия timestamp по умолчанию — текущее unix-время: %d", ts.Version)
	}
}

func TestKeyFromEnvAndNeverPrinted(t *testing.T) {
	h := newHarness(t)
	secret, _ := os.ReadFile(h.p("manifest.sec"))
	h.env["LAVRAY_MANIFEST_KEY"] = string(secret)
	_ = os.WriteFile(h.p("sources-draft.json"), []byte(`{"type":"sources","version":1,"artifacts":["https://a.example/dl"],"metadata":["https://m.example/meta"]}`), 0o644)
	code, out, errw := h.run("sources", "-key", "env:LAVRAY_MANIFEST_KEY", "-in", h.p("sources-draft.json"), "-out", h.p("meta/sources.json"))
	if code != 0 {
		t.Fatalf("ключ из переменной окружения: %d %s", code, errw)
	}
	line := strings.Split(strings.TrimSpace(string(secret)), "\n")[1]
	for name, text := range map[string]string{"stdout": out, "stderr": errw} {
		if strings.Contains(text, line) {
			t.Errorf("секретный ключ напечатан в %s", name)
		}
	}
	if code, _, _ := h.run("sources", "-key", "env:ПУСТО", "-in", h.p("sources-draft.json"), "-out", h.p("x.json")); code == 0 {
		t.Error("пустая переменная окружения должна быть ошибкой")
	}
	// секретный ключ не печатается и при genkey
	_, genOut, genErr := h.run("genkey", "-role", "root", "-out", h.p("another.sec"))
	raw, _ := os.ReadFile(h.p("another.sec"))
	if l := strings.Split(strings.TrimSpace(string(raw)), "\n")[1]; strings.Contains(genOut+genErr, l) {
		t.Error("genkey напечатал секрет")
	}
	if code, _, errw := h.run("genkey", "-role", "root", "-out", h.p("another.sec")); code == 0 || !strings.Contains(errw, "уже существует") {
		t.Errorf("существующий ключ не перезаписывается: %d %s", code, errw)
	}
}

func TestRootRotationSigning(t *testing.T) {
	h := newHarness(t)
	h.must("genkey", "-role", "root", "-out", h.p("root2.sec"), "-pub", h.p("root2.pub.json"))
	var pub struct {
		RootKey map[string]string `json:"root_key"`
	}
	raw, _ := os.ReadFile(h.p("root2.pub.json"))
	_ = json.Unmarshal(raw, &pub)
	var draft map[string]any
	old, _ := os.ReadFile(h.p("root-draft.json"))
	_ = json.Unmarshal(old, &draft)
	draft["version"] = 2
	draft["keys"].(map[string]any)["k2"] = map[string]any{"alg": "ed25519", "pub": pub.RootKey["pub"]}
	draft["roles"].(map[string]any)["root"] = map[string]any{"keyids": []string{"k2"}, "threshold": 1}
	d2, _ := json.Marshal(draft)
	_ = os.WriteFile(h.p("root2-draft.json"), d2, 0o644)
	// только новым ключом — ротация отвергается и файл не остаётся
	if code, _, _ := h.run("root", "-key", "k2=file:"+h.p("root2.sec"), "-in", h.p("root2-draft.json"), "-out", h.p("meta/2.root.json"), "-prev", h.root); code == 0 {
		t.Fatal("ротация без подписи старого корня должна отвергаться")
	}
	if _, err := os.Stat(h.p("meta/2.root.json")); err == nil {
		t.Fatal("отвергнутый корень не должен оставаться на диске")
	}
	h.must("root", "-key", "k1=file:"+h.p("root.sec"), "-key", "k2=file:"+h.p("root2.sec"),
		"-in", h.p("root2-draft.json"), "-out", h.p("meta/2.root.json"), "-prev", h.root)
}

func TestArtifactSignatureFile(t *testing.T) {
	h := newHarness(t)
	file := h.p("setup.exe")
	_ = os.WriteFile(file, []byte("installer"), 0o644)
	h.must("artifact", "-key", "file:"+h.p("artifact.sec"), "-file", file, "-product", "lavray-windows", "-version", "0.5.1", "-serial", "3")
	raw, err := os.ReadFile(file + ".minisig")
	if err != nil {
		t.Fatal(err)
	}
	sig, err := updates.ParseMinisig(raw)
	if err != nil || sig.TrustedComment != "lavray-windows;windows-x64;stable;0.5.1;3" {
		t.Fatalf("подпись artifact: %+v %v", sig, err)
	}
	if code, _, _ := h.run("artifact", "-key", "file:"+h.p("artifact.sec"), "-file", file); code == 0 {
		t.Fatal("без product/version/serial подписывать нельзя")
	}
	if code, _, _ := h.run("nonsense"); code != 2 {
		t.Fatalf("неизвестная команда: код %d", code)
	}
	if code, _, _ := h.run(); code != 2 {
		t.Fatalf("без команды: код %d", code)
	}
}
