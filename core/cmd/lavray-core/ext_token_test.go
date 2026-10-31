// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"bufio"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

const fileToken = "file-token-0123456789abcdef0123456789abcdef"

func writeTokenFile(t *testing.T, content string, mode os.FileMode) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "core.token")
	if err := os.WriteFile(p, []byte(content), mode); err != nil {
		t.Fatal(err)
	}
	return p
}

// TestTokenFileFeedsStartupReader — токен из файла приходит читателю stdin как
// первая строка, а EOF не наступает никогда: сервисный режим не умирает от EOF.
func TestTokenFileFeedsStartupReader(t *testing.T) {
	f := &extFlags{platform: platformDesktop, tokenFile: writeTokenFile(t, fileToken+"\n", 0o600)}
	if msg := f.validate(); msg != "" {
		t.Fatal(msg)
	}
	token, agent, dead := make(chan string, 1), make(chan string, 1), make(chan struct{})
	go readStartupStdin(f.input(strings.NewReader("")), token, agent, dead)
	select {
	case got := <-token:
		if got != fileToken {
			t.Fatalf("токен = %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("токен не получен")
	}
	select {
	case <-dead:
		t.Fatal("читатель увидел EOF: ядро вышло бы сразу после старта")
	case <-time.After(150 * time.Millisecond):
	}
}

func TestTokenFileDisabledKeepsStdin(t *testing.T) {
	f := &extFlags{}
	in := strings.NewReader("x")
	if f.input(in) != io.Reader(in) {
		t.Fatal("без --token-file вход должен остаться stdin")
	}
}

func TestTokenFileValidation(t *testing.T) {
	cases := []struct {
		name    string
		path    string
		want    string
		skipWin bool
	}{
		{"нет файла", filepath.Join(t.TempDir(), "absent"), "--token-file", false},
		{"пустой", writeTokenFile(t, "\n", 0o600), "короче", false},
		{"короткий", writeTokenFile(t, "short", 0o600), "короче", false},
		{"читается всеми", writeTokenFile(t, fileToken, 0o644), "доступен", true},
	}
	for _, c := range cases {
		if c.skipWin && runtime.GOOS == "windows" {
			continue
		}
		f := &extFlags{platform: platformDesktop, tokenFile: c.path}
		if msg := f.validate(); !strings.Contains(msg, c.want) {
			t.Errorf("%s: сообщение %q, ждали %q", c.name, msg, c.want)
		}
	}
}

// TestTokenFileServiceModeSurvivesEOF — бинарь с --token-file принимает токен из
// файла и не выходит, хотя его stdin пуст (служба procd без оболочки).
func TestTokenFileServiceModeSurvivesEOF(t *testing.T) {
	exe := buildCore(t)
	dir, _ := os.MkdirTemp("", "core-tokfile-*")
	t.Cleanup(func() { removeAllRetry(dir) })
	tokenPath := writeTokenFile(t, fileToken+"\n", 0o600)
	cmd := exec.Command(exe, "serve", "--listen-socket", "127.0.0.1:0", "--data", dir, "--token-file", tokenPath)
	// Stdin не задан: процесс получает пустой ввод, то есть немедленный EOF.
	stdout, _ := cmd.StdoutPipe()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	sc := bufio.NewScanner(stdout)
	var base string
	for sc.Scan() {
		if v, ok := strings.CutPrefix(sc.Text(), "LAVRAY_CORE_READY tcp://"); ok {
			base = "http://" + v
			break
		}
	}
	if base == "" {
		t.Fatal("ядро не сообщило готовность")
	}
	time.Sleep(500 * time.Millisecond) // EOF stdin уже должен был бы остановить ядро
	c := newWebClient(t, base)
	if r := c.do(http.MethodPost, "/lavray.v1.CoreService/GetStatus", `{}`, map[string]string{"Authorization": "Bearer " + fileToken}); r.status != 200 {
		t.Fatalf("токен из файла не принят: %d %s", r.status, r.raw)
	}
	if r := c.do(http.MethodPost, "/lavray.v1.CoreService/GetStatus", `{}`, nil); r.status != 401 {
		t.Fatalf("без токена: %d", r.status)
	}
}
