// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/api"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/logs"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
)

const (
	mainToken  = "main-token-0123456789abcdef0123456789abcdef"
	agentToken = "agent-token-0123456789abcdef0123456789abc"
)

// Агентский токен проходит с отметкой агента в контексте, основной — без неё;
// чужие токены, схема без Bearer и пустой агентский токен ядра отклоняются.
func TestAuthMiddlewareAgentToken(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	srv := api.NewServer(api.Deps{Store: st})

	var sawAgent bool
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAgent = api.IsAgent(r.Context())
		w.WriteHeader(http.StatusOK)
	})
	h := authMiddlewareAgent(next, mainToken, srv, logs.NewMux(10))
	do := func(header string) (int, bool) {
		sawAgent = false
		req := httptest.NewRequest(http.MethodPost, "/lavray.v1.CoreService/GetStatus", nil)
		if header != "" {
			req.Header.Set("Authorization", header)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code, sawAgent
	}

	// агентский токен ещё не передан ядру: запросы с ним отклоняются
	if code, _ := do("Bearer " + agentToken); code != http.StatusUnauthorized {
		t.Fatalf("агентский токен до выдачи: статус %d, ожидался 401", code)
	}
	srv.SetAgentToken(agentToken)

	if code, agent := do("Bearer " + agentToken); code != http.StatusOK || !agent {
		t.Errorf("агентский токен: статус %d, агент=%v, ожидались 200 и true", code, agent)
	}
	if code, agent := do("bearer  " + agentToken); code != http.StatusOK || !agent {
		t.Errorf("агентский токен, схема в нижнем регистре: статус %d, агент=%v", code, agent)
	}
	if code, agent := do("Bearer " + mainToken); code != http.StatusOK || agent {
		t.Errorf("основной токен: статус %d, агент=%v, ожидались 200 и false", code, agent)
	}
	for _, header := range []string{"", agentToken, "Basic " + agentToken, "Bearer wrong", "Bearer ", "Bearer " + agentToken + "x"} {
		if code, _ := do(header); code != http.StatusUnauthorized {
			t.Errorf("Authorization=%q: статус %d, ожидался 401", header, code)
		}
	}
	srv.SetAgentToken("")
	if code, _ := do("Bearer " + agentToken); code != http.StatusUnauthorized {
		t.Errorf("после сброса агентского токена: статус %d, ожидался 401", code)
	}
	if code, _ := do("Bearer "); code != http.StatusUnauthorized {
		t.Errorf("пустой Bearer при пустом агентском токене: статус %d, ожидался 401", code)
	}
}

// Читатель stdin: основной токен — первая строка, агентский — вторая, дальше
// чтение до EOF = смерть оболочки.
func TestReadStartupStdinLines(t *testing.T) {
	cases := []struct {
		name      string
		input     string
		wantToken string
		wantAgent []string // nil — второй строки не будет (канал закроется пустым)
	}{
		{"две строки", mainToken + "\n" + agentToken + "\n", mainToken, []string{agentToken}},
		{"вторая строка с \\r\\n", mainToken + "\r\n" + agentToken + "\r\n", mainToken, []string{agentToken}},
		{"одна строка", mainToken + "\n", mainToken, nil},
		{"первая строка без перевода", mainToken, mainToken, nil},
		{"вторая строка без перевода — не токен", mainToken + "\n" + agentToken, mainToken, nil},
		{"пусто", "", "", nil},
		{"хвост после второй строки", mainToken + "\n" + agentToken + "\nlorem ipsum\n", mainToken, []string{agentToken}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			token := make(chan string, 1)
			agent := make(chan string, 1)
			dead := make(chan struct{})
			go readStartupStdin(strings.NewReader(c.input), token, agent, dead)

			if got := <-token; got != c.wantToken {
				t.Errorf("основной токен %q, ожидался %q", got, c.wantToken)
			}
			var gotAgent []string
			for v := range agent {
				gotAgent = append(gotAgent, v)
			}
			if strings.Join(gotAgent, "|") != strings.Join(c.wantAgent, "|") {
				t.Errorf("агентский токен %q, ожидался %q", gotAgent, c.wantAgent)
			}
			select {
			case <-dead:
			case <-time.After(2 * time.Second):
				t.Error("EOF не сообщил о смерти оболочки")
			}
		})
	}
}

// Пока оболочка держит stdin открытым, смерть не объявляется; вторая строка,
// пришедшая позже первой, доходит до получателя.
func TestReadStartupStdinWaitsForShell(t *testing.T) {
	pr, pw := io.Pipe()
	token := make(chan string, 1)
	agent := make(chan string, 1)
	dead := make(chan struct{})
	go readStartupStdin(pr, token, agent, dead)

	_, _ = pw.Write([]byte(mainToken + "\n"))
	if got := <-token; got != mainToken {
		t.Fatalf("основной токен %q", got)
	}
	select {
	case v := <-agent:
		t.Fatalf("агентский токен %q пришёл до записи", v)
	case <-time.After(100 * time.Millisecond):
	}
	_, _ = pw.Write([]byte(agentToken + "\n"))
	if got := <-agent; got != agentToken {
		t.Errorf("агентский токен %q", got)
	}
	select {
	case <-dead:
		t.Fatal("смерть оболочки объявлена при открытом stdin")
	case <-time.After(100 * time.Millisecond):
	}
	_ = pw.Close()
	select {
	case <-dead:
	case <-time.After(2 * time.Second):
		t.Fatal("закрытие stdin не замечено")
	}
}
