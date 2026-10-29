// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"bufio"
	"bytes"
	"net"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"
)

func execBuild(exe string) (string, error) {
	cmd := exec.Command("go", "build", "-o", exe, ".")
	var buf bytes.Buffer
	cmd.Stderr = &buf
	err := cmd.Run()
	return buf.String(), err
}

// E2E спавна: токен из stdin → LAVRAY_CORE_READY в stdout → /healthz открыт,
// API без токена 401, с токеном 200.
func TestServeSpawnProtocol(t *testing.T) {
	dir, _ := os.MkdirTemp("", "core-e2e-*")
	defer func() {
		for i := 0; i < 50; i++ {
			if os.RemoveAll(dir) == nil {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
	exe := buildCore(t)
	var sock string
	if runtime.GOOS == "windows" {
		sock = "127.0.0.1:0" // named-pipe для net/http нестандартен — loopback TCP
	} else {
		sock = dir + "/test.sock"
	}
	cmd := exec.Command(exe, "serve", "--listen-socket", sock, "--data", dir)
	cmd.Stderr = os.Stderr
	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { stdin.Close(); cmd.Process.Kill(); cmd.Wait() }()

	token := "test-token-0123456789abcdef0123456789abcdef"
	if _, err := stdin.Write([]byte(token + "\n")); err != nil {
		t.Fatal(err)
	}
	sc := bufio.NewScanner(stdout)
	deadline := time.Now().Add(10 * time.Second)
	var transport string
	for time.Now().Before(deadline) {
		if !sc.Scan() {
			t.Fatalf("stdout закрыт до READY: scan-err=%v", sc.Err())
		}
		line := sc.Text()
		if strings.HasPrefix(line, "LAVRAY_CORE_READY ") {
			transport = strings.TrimPrefix(line, "LAVRAY_CORE_READY ")
			break
		}
	}
	if transport == "" {
		t.Fatal("LAVRAY_CORE_READY не получен")
	}
	// Сокет отвечает (UDS) или TCP-адрес из transport.
	var dialAddr string
	if runtime.GOOS == "windows" {
		dialAddr = strings.TrimPrefix(transport, "tcp://")
	} else {
		dialAddr = sock
	}
	dial := func() net.Conn {
		network := "tcp"
		if runtime.GOOS != "windows" {
			network = "unix"
		}
		c, err := net.Dial(network, dialAddr)
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	httpGet := func(path, auth string) (int, string) {
		c := dial()
		defer c.Close()
		req := "GET " + path + " HTTP/1.1\r\nHost: t\r\nConnection: close\r\n"
		if auth != "" {
			req += "Authorization: Bearer " + auth + "\r\n"
		}
		req += "\r\n"
		c.SetDeadline(time.Now().Add(5 * time.Second))
		c.Write([]byte(req))
		buf := make([]byte, 1024)
		n, _ := c.Read(buf)
		return parseStatus(string(buf[:n])), string(buf[:n])
	}
	if code, _ := httpGet("/healthz", ""); code != 200 {
		t.Fatalf("healthz: %d", code)
	}
	if code, _ := httpGet("/lavray.v1.CoreService/GetStatus", "wrong"); code != 401 {
		t.Fatalf("чужой токен: %d", code)
	}
	if code, _ := httpGet("/lavray.v1.CoreService/GetStatus", token); code == 401 {
		t.Fatalf("верный токен отвергнут: %d", code)
	}
	if code, _ := httpGet("/lavray.v1.CoreService/GetStatus", ""); code != 401 {
		t.Fatalf("без токена: %d", code)
	}
}

func parseStatus(resp string) int {
	// "HTTP/1.1 200 OK"
	parts := strings.SplitN(resp, " ", 3)
	if len(parts) < 2 {
		return 0
	}
	code := 0
	for _, r := range parts[1] {
		if r < '0' || r > '9' {
			return 0
		}
		code = code*10 + int(r-'0')
	}
	return code
}

func buildCore(t *testing.T) string {
	t.Helper()
	exe := t.TempDir() + string(os.PathSeparator) + "lavray-core-test.exe"
	out, err := execBuild(exe)
	if err != nil {
		t.Fatalf("build: %v (%s)", err, out)
	}
	return exe
}

// Пустой токен (оболочка не передала секрет) — ядро обязано отклонять ВСЕ
// запросы (fail-closed), а не открываться.
func TestEmptyTokenRejectsAll(t *testing.T) {
	dir, _ := os.MkdirTemp("", "core-empty-token-*")
	defer os.RemoveAll(dir)
	exe := buildCore(t)
	cmd := exec.Command(exe, "serve", "--listen-socket", "127.0.0.1:0", "--data", dir)
	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { stdin.Close(); cmd.Process.Kill(); cmd.Wait() }()

	// Пустая строка = токена нет.
	if _, err := stdin.Write([]byte("\n")); err != nil {
		t.Fatal(err)
	}
	sc := bufio.NewScanner(stdout)
	var port string
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "LAVRAY_CORE_READY ") {
			port = strings.TrimPrefix(line, "LAVRAY_CORE_READY tcp://")
			break
		}
	}
	if port == "" {
		t.Fatal("READY не получен")
	}
	c, err := net.Dial("tcp", port)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(5 * time.Second))
	// Без Authorization — 401, даже при пустом ожидаемом токене.
	c.Write([]byte("GET /lavray.v1.CoreService/GetStatus HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n"))
	buf := make([]byte, 256)
	n, _ := c.Read(buf)
	if code := parseStatus(string(buf[:n])); code != 401 {
		t.Fatalf("пустой токен открыл доступ: %d", code)
	}
}
