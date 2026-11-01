// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"bufio"
	"encoding/base64"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates/updatestest"
)

const versionPkg = "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/version"

// buildCoreFlags собирает ядро с флагами компоновщика (ldflags может быть пустым).
func buildCoreFlags(t *testing.T, ldflags string) string {
	t.Helper()
	exe := filepath.Join(t.TempDir(), "lavray-core-flags.exe")
	args := []string{"build", "-o", exe}
	if ldflags != "" {
		args = append(args, "-ldflags", ldflags)
	}
	out, err := exec.Command("go", append(args, ".")...).CombinedOutput()
	if err != nil {
		t.Fatalf("сборка с ldflags %q: %v (%s)", ldflags, err, out)
	}
	return exe
}

// runCore запускает собранное ядро на loopback и возвращает адрес и токен.
func runCore(t *testing.T, exe string) (addr, token string) {
	t.Helper()
	dir, err := os.MkdirTemp("", "core-upd-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for i := 0; i < 50 && os.RemoveAll(dir) != nil; i++ {
			time.Sleep(20 * time.Millisecond)
		}
	})
	cmd := exec.Command(exe, "serve", "--listen-socket", "127.0.0.1:0", "--data", dir)
	in, _ := cmd.StdinPipe()
	out, _ := cmd.StdoutPipe()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = in.Close(); _ = cmd.Process.Kill(); _ = cmd.Wait() })
	token = "update-token-0123456789abcdef0123456789abcdef"
	_, _ = in.Write([]byte(token + "\n"))
	sc := bufio.NewScanner(out)
	for sc.Scan() {
		if line := sc.Text(); strings.HasPrefix(line, "LAVRAY_CORE_READY tcp://") {
			addr = strings.TrimPrefix(line, "LAVRAY_CORE_READY tcp://")
			break
		}
	}
	if addr == "" {
		t.Fatal("LAVRAY_CORE_READY не получен")
	}
	go func() { _, _ = io.Copy(io.Discard, out) }()
	return addr, token
}

// rpc вызывает unary-метод Connect (JSON) и возвращает код HTTP и тело.
func rpc(t *testing.T, addr, token, method string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, "http://"+addr+"/lavray.v1."+method, strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		t.Fatalf("%s: %v", method, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(body)
}

// Сборка без корня доверия: CheckUpdates честно говорит «не настроено».
func TestCoreReportsUpdatesNotConfigured(t *testing.T) {
	addr, token := runCore(t, buildCoreFlags(t, ""))
	code, body := rpc(t, addr, token, "UpdateService/CheckUpdates")
	if code != http.StatusBadRequest || !strings.Contains(body, "failed_precondition") || !strings.Contains(body, "not_configured: updates not configured") {
		t.Fatalf("сборка с заглушкой: %d %s", code, body)
	}
}

// Сборка с корнем (флаг компоновщика): CheckUpdates доходит до сети. Источник
// недоступен, поэтому ответ UNAVAILABLE, а не «не сконфигурировано».
func TestCoreReportsUpdatesConfigured(t *testing.T) {
	root := base64.StdEncoding.EncodeToString(updatestest.New(t).RootJSON)
	exe := buildCoreFlags(t, "-X main.rootJSONB64="+root+" -X main.bootstrapURLs=http://127.0.0.1:1")
	addr, token := runCore(t, exe)
	code, body := rpc(t, addr, token, "UpdateService/CheckUpdates")
	if strings.Contains(body, "not_configured") || strings.Contains(body, "не сконфигурированы") {
		t.Fatalf("корень задан, а ядро отвечает «не настроено»: %d %s", code, body)
	}
	if code != http.StatusServiceUnavailable || !strings.Contains(body, "unavailable") {
		t.Fatalf("ожидался UNAVAILABLE (источник недоступен): %d %s", code, body)
	}
}

func TestAppVersionLdflag(t *testing.T) {
	addr, token := runCore(t, buildCoreFlags(t, "-X "+versionPkg+".Version=9.9.9"))
	code, body := rpc(t, addr, token, "CoreService/GetStatus")
	if code != http.StatusOK || !strings.Contains(body, "9.9.9") {
		t.Fatalf("версия из ldflags не дошла до ядра: %d %s", code, body)
	}
}

func TestPlaceholderRootIsNotConfigured(t *testing.T) {
	for name, raw := range map[string]string{"пусто": "", "пробелы": "  \n", "заглушка": string(embeddedRoot), "объект": `{"a":1}`} {
		if !isPlaceholderRoot([]byte(raw)) {
			t.Errorf("%s: должно считаться заглушкой", name)
		}
	}
	if isPlaceholderRoot([]byte(`{"signed":{},"signatures":[]}`)) || isPlaceholderRoot([]byte("не json")) {
		t.Error("документ с signed (или мусор) не заглушка: ошибку разберёт NewTrust")
	}
	if trustRootJSON() != nil && isPlaceholderRoot(embeddedRoot) {
		t.Error("заглушка не должна считаться корнем")
	}
}

func TestLdflagRootOverridesEmbedded(t *testing.T) {
	root := updatestest.New(t).RootJSON
	old := rootJSONB64
	defer func() { rootJSONB64 = old }()
	rootJSONB64 = base64.StdEncoding.EncodeToString(root)
	if got := trustRootJSON(); string(got) != string(root) {
		t.Fatal("корень из флага компоновщика должен перебивать файл")
	}
	rootJSONB64 = "%%%не base64%%%"
	if got := trustRootJSON(); string(got) != "" && !isPlaceholderRoot(embeddedRoot) {
		t.Fatal("испорченный флаг не должен давать корень")
	}
}

// Корень доверия, если он вшит, действителен и живёт не меньше 180 дней.
func TestEmbeddedRootValid(t *testing.T) {
	raw := trustRootJSON()
	if raw == nil {
		t.Skip("в этой сборке нет корня доверия (root.json — заглушка до церемонии ключей)")
	}
	tr, err := updates.NewTrust(raw)
	if err != nil {
		t.Fatalf("вшитый root.json недействителен: %v", err)
	}
	if left := time.Until(tr.Root().Expires); left < 180*24*time.Hour {
		t.Fatalf("корень истекает через %v (< 180 дней): время выпускать новый", left.Round(time.Hour))
	}
	if _, err := tr.Root().ArtifactKeys(); err != nil {
		t.Fatalf("в корне нет роли artifact: %v", err)
	}
}

// privateKeyMarkers — форматы приватных ключей подписи обновлений: файл updsign
// genkey и зашифрованный ключ minisign (за заголовком идёт строка base64).
var privateKeyMarkers = []*regexp.Regexp{
	regexp.MustCompile(`(?i)lavray updsign secret key[^\n]*\n[A-Za-z0-9+/=]{20,}`),
	regexp.MustCompile(`(?i)minisign encrypted secret key[^\n]*\n[A-Za-z0-9+/=]{20,}`),
}

// TestNoPrivateKeysInTree: в репозитории нет файлов приватных ключей и их содержимого.
func TestNoPrivateKeysInTree(t *testing.T) {
	root := repoRoot(t)
	filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			switch d.Name() {
			case ".git", "node_modules", "target", "dist":
				return filepath.SkipDir
			}
			return nil
		}
		name := strings.ToLower(d.Name())
		if strings.HasSuffix(name, ".minisec") || strings.HasSuffix(name, ".key") || strings.HasSuffix(name, ".secret") {
			t.Errorf("в дереве файл приватного ключа: %s", p)
			return nil
		}
		if fi, err := d.Info(); err != nil || fi.Size() > 1<<20 {
			return nil
		}
		raw, _ := os.ReadFile(p)
		for _, re := range privateKeyMarkers {
			if re.Match(raw) {
				t.Errorf("в %s похоже на приватный ключ: %s", p, re)
			}
		}
		return nil
	})
}

func repoRoot(t *testing.T) string {
	t.Helper()
	dir, _ := os.Getwd()
	for i := 0; i < 6; i++ {
		if _, err := os.Stat(filepath.Join(dir, "proto", "lavray.proto")); err == nil {
			return dir
		}
		dir = filepath.Dir(dir)
	}
	t.Skip("корень репозитория не найден: ядро собрано вне репозитория lavray")
	return ""
}
