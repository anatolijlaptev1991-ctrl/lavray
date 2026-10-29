// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"bufio"
	"bytes"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
)

// t50Dir — каталог данных с ретрай-удалением (гонка -wal/-shm на Windows).
func t50Dir(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "lavray-core-t50-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for i := 0; i < 50; i++ {
			if os.RemoveAll(dir) == nil {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	})
	return dir
}

// t50RunToExit запускает ядро и ждёт завершения (стартовый отказ).
func t50RunToExit(t *testing.T, exe, dataDir string) (stderr string, exitCode int) {
	t.Helper()
	cmd := exec.Command(exe, "serve", "--listen-socket", "127.0.0.1:0", "--data", dataDir)
	var errBuf bytes.Buffer
	cmd.Stderr = &errBuf
	if _, err := cmd.StdinPipe(); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		_ = cmd.Process.Kill()
		<-done
		t.Fatal("ядро не завершилось за 30 с, хотя ожидался отказ запуска")
	}
	return errBuf.String(), cmd.ProcessState.ExitCode()
}

// T-50 (A1-14, A1-15): отказы запуска объяснены в stderr и не трогают файл БД;
// сервер ядра режет гигантские заголовки. Ядро собирается один раз.
func TestStartupFailuresAndServerLimits(t *testing.T) {
	exe := buildCore(t)

	t.Run("повреждённая БД", func(t *testing.T) {
		dir := t50Dir(t)
		path := store.DBPath(dir)
		garbage := []byte("this is not a sqlite database, garbage garbage garbage garbage")
		if err := os.WriteFile(path, garbage, 0o600); err != nil {
			t.Fatal(err)
		}
		stderr, code := t50RunToExit(t, exe, dir)
		if code == 0 {
			t.Fatal("ядро с повреждённой БД завершилось с кодом 0")
		}
		for _, want := range []string{"повреждена", path, "Файл не изменён", "переименуйте", "резервная копия"} {
			if !strings.Contains(stderr, want) {
				t.Errorf("в stderr нет %q; stderr целиком:\n%s", want, stderr)
			}
		}
		after, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(after, garbage) {
			t.Fatalf("файл БД изменён или удалён: err=%v", err)
		}
	})

	t.Run("БД из будущей версии", func(t *testing.T) {
		dir := t50Dir(t)
		s, err := store.Open(dir)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.DB().Exec(`INSERT INTO schema_version (version, applied_at_ms) VALUES (99, 0)`); err != nil {
			t.Fatal(err)
		}
		if err := s.Close(); err != nil {
			t.Fatal(err)
		}
		stderr, code := t50RunToExit(t, exe, dir)
		if code == 0 {
			t.Fatal("ядро с БД из будущей версии завершилось с кодом 0")
		}
		for _, want := range []string{"более новой версией", "v99", "Файл не изменён"} {
			if !strings.Contains(stderr, want) {
				t.Errorf("в stderr нет %q; stderr целиком:\n%s", want, stderr)
			}
		}
	})

	t.Run("гигантские заголовки", func(t *testing.T) {
		dir := t50Dir(t)
		cmd := exec.Command(exe, "serve", "--listen-socket", "127.0.0.1:0", "--data", dir)
		stdin, err := cmd.StdinPipe()
		if err != nil {
			t.Fatal(err)
		}
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		defer func() { _ = stdin.Close(); _ = cmd.Process.Kill(); _ = cmd.Wait() }()
		if _, err := stdin.Write([]byte("t50-token\n")); err != nil {
			t.Fatal(err)
		}
		sc := bufio.NewScanner(stdout)
		addr := ""
		for sc.Scan() {
			if rest, ok := strings.CutPrefix(sc.Text(), "LAVRAY_CORE_READY tcp://"); ok {
				addr = rest
				break
			}
		}
		if addr == "" {
			t.Fatal("LAVRAY_CORE_READY не получен")
		}
		conn, err := net.Dial("tcp", addr)
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(15 * time.Second))
		// Запись — в горутине: сервер отвечает 431 и закрывает соединение, не
		// дочитав заголовок; ошибку записи игнорируем, важен ответ.
		go func() {
			req := "GET /healthz HTTP/1.1\r\nHost: t\r\nConnection: close\r\nX-Pad: " +
				strings.Repeat("a", 100<<10) + "\r\n\r\n"
			_, _ = conn.Write([]byte(req))
		}()
		status, err := bufio.NewReader(conn).ReadString('\n')
		if err != nil || !strings.Contains(status, " 431 ") {
			t.Fatalf("заголовок 100 КиБ: статус %q (err=%v), ожидался 431", strings.TrimSpace(status), err)
		}
	})
}

// Конфигурация сервера: таймауты есть, а Read/WriteTimeout отсутствуют — они
// оборвали бы серверные стримы (журнал, события, обновление подписок).
func TestNewHTTPServerLimits(t *testing.T) {
	srv := newHTTPServer(http.NotFoundHandler())
	if srv.ReadHeaderTimeout <= 0 || srv.ReadHeaderTimeout > 30*time.Second {
		t.Errorf("ReadHeaderTimeout = %v, ожидалось от 1 нс до 30 с", srv.ReadHeaderTimeout)
	}
	if srv.IdleTimeout <= 0 {
		t.Errorf("IdleTimeout = %v, ожидался положительный", srv.IdleTimeout)
	}
	if srv.MaxHeaderBytes <= 0 || srv.MaxHeaderBytes > 256<<10 {
		t.Errorf("MaxHeaderBytes = %d, ожидалось от 1 байта до 256 КиБ", srv.MaxHeaderBytes)
	}
	if srv.ReadTimeout != 0 || srv.WriteTimeout != 0 {
		t.Errorf("ReadTimeout=%v WriteTimeout=%v: должны быть 0, иначе оборвутся стримы", srv.ReadTimeout, srv.WriteTimeout)
	}
}
