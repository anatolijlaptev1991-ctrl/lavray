package main

import (
	"bufio"
	"bytes"
	"context"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/logs"
)

type orderStopper struct {
	mu     sync.Mutex
	events []string
}

func (o *orderStopper) add(e string) { o.mu.Lock(); o.events = append(o.events, e); o.mu.Unlock() }

func (o *orderStopper) StopInstance(context.Context) error { o.add("stop-instance"); return nil }

// Выход сначала останавливает sing-box (TUN снимается), и только потом закрывает
// HTTP: раньше при EOF stdin и сигнале закрывался один HTTP.
func TestGracefulExitStopsInstanceBeforeHTTPShutdown(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	rec := &orderStopper{}
	srv := &http.Server{Handler: http.NewServeMux()}
	srv.RegisterOnShutdown(func() { rec.add("http-shutdown") }) // хук идёт в своей горутине
	go func() { _ = srv.Serve(ln) }()

	var stderr bytes.Buffer
	gracefulExit(rec, srv, logs.NewMux(10), &stderr, time.Second)

	count := func() int { rec.mu.Lock(); defer rec.mu.Unlock(); return len(rec.events) }
	for i := 0; i < 200 && count() < 2; i++ {
		time.Sleep(5 * time.Millisecond)
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.events) != 2 || rec.events[0] != "stop-instance" || rec.events[1] != "http-shutdown" {
		t.Fatalf("порядок выхода = %v, ожидалось [stop-instance http-shutdown]", rec.events)
	}
	if !strings.Contains(stderr.String(), "инстанс остановлен") {
		t.Fatalf("в stderr нет строки для кольца логов оболочки: %q", stderr.String())
	}
}

// startLiveCore запускает собранное ядро (NopRunner) и ждёт LAVRAY_CORE_READY.
func startLiveCore(t *testing.T) (cmd *exec.Cmd, stdin interface{ Close() error }, addr, token string, stderr *bytes.Buffer) {
	t.Helper()
	dir, err := os.MkdirTemp("", "core-shutdown-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for i := 0; i < 50 && os.RemoveAll(dir) != nil; i++ {
			time.Sleep(20 * time.Millisecond)
		}
	})
	cmd = exec.Command(buildCore(t), "serve", "--listen-socket", "127.0.0.1:0", "--data", dir)
	stderr = &bytes.Buffer{}
	cmd.Stderr = stderr
	in, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = in.Close(); _ = cmd.Process.Kill() })
	token = "shutdown-token-0123456789abcdef0123456789"
	if _, err := in.Write([]byte(token + "\n")); err != nil {
		t.Fatal(err)
	}
	sc := bufio.NewScanner(stdout)
	for sc.Scan() {
		if line := sc.Text(); strings.HasPrefix(line, "LAVRAY_CORE_READY tcp://") {
			addr = strings.TrimPrefix(line, "LAVRAY_CORE_READY tcp://")
			break
		}
	}
	if addr == "" {
		t.Fatal("LAVRAY_CORE_READY не получен")
	}
	go func() {
		for sc.Scan() { // stdout надо дочитывать, иначе Wait не завершится
		}
	}()
	return cmd, in, addr, token, stderr
}

func waitExit(t *testing.T, cmd *exec.Cmd) {
	t.Helper()
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("ядро вышло с ошибкой: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("процесс ядра не завершился за 5s")
	}
}

// RPC Shutdown обязан завершать процесс: раньше он останавливал инстанс, но
// OnShutdown не был назначен, и ядро жило дальше.
func TestShutdownRPCEndsTheCoreProcess(t *testing.T) {
	cmd, _, addr, token, _ := startLiveCore(t)
	req, _ := http.NewRequest(http.MethodPost, "http://"+addr+"/lavray.v1.CoreService/Shutdown", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		t.Fatalf("RPC Shutdown: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("RPC Shutdown: статус %d, ожидался 200", resp.StatusCode)
	}
	waitExit(t, cmd)
}

// EOF на stdin (оболочка умерла) ведёт к остановке инстанса и штатному выходу;
// об этом ядро пишет в stderr — строка попадает в кольцо логов оболочки.
func TestStdinEOFStopsTheInstanceAndExits(t *testing.T) {
	cmd, stdin, _, _, stderr := startLiveCore(t)
	_ = stdin.Close()
	waitExit(t, cmd)
	if !strings.Contains(stderr.String(), "инстанс остановлен") {
		t.Fatalf("при EOF stdin инстанс не остановлен штатно; stderr = %q", stderr.String())
	}
}
