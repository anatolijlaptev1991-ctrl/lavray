// SPDX-License-Identifier: GPL-3.0-only

package inst

import (
	"strings"
	"sync"
	"testing"
)

// T-33: разбор строк журнала sing-box и писатель для SetLogWritter.
// Формат строк — sing-box log/format.go: «INFO[0000] тег: сообщение» (метка
// уровня в верхнем регистре, при цветном выводе обёрнута в ANSI).

func TestParseSingBoxLine(t *testing.T) {
	cases := []struct {
		name, line, wantLevel, wantMsg string
	}{
		{"info цветной", "\x1b[36mINFO\x1b[0m[0000] inbound/mixed[mixed-in]: tcp server started at 127.0.0.1:2080",
			"info", "inbound/mixed[mixed-in]: tcp server started at 127.0.0.1:2080"},
		{"info без цвета", "INFO[0012] sing-box started (0.05s)", "info", "sing-box started (0.05s)"},
		{"warn", "WARN[0001] dns: lookup failed", "warn", "dns: lookup failed"},
		{"error с префиксом соединения", "\x1b[31mERROR\x1b[0m[0003] [\x1b[38;5;81m123\x1b[0m 5ms] connection: open connection to a.example:443 failed",
			"error", "[123 5ms] connection: open connection to a.example:443 failed"},
		{"debug", "DEBUG[0000] router: match", "debug", "router: match"},
		{"trace", "TRACE[0000] dns: cache hit", "trace", "dns: cache hit"},
		{"fatal считается ошибкой", "FATAL[0000] start service: boom", "error", "start service: boom"},
		{"panic", "PANIC[0000] oops", "panic", "oops"},
		{"с временной меткой (log.timestamp)", "-0700 2026-10-29 12:00:00 INFO sing-box started", "info", "sing-box started"},
		{"слово ERROR внутри сообщения не путает", "INFO[0000] counter ERROR reset", "info", "counter ERROR reset"},
		{"без метки — info целиком", "просто текст", "info", "просто текст"},
	}
	for _, tc := range cases {
		level, msg := parseSingBoxLine(tc.line)
		if level != tc.wantLevel || msg != tc.wantMsg {
			t.Errorf("%s: получили (%q, %q), ожидалось (%q, %q)", tc.name, level, msg, tc.wantLevel, tc.wantMsg)
		}
	}
}

type captured struct{ level, msg string }

func collect() (LogSink, func() []captured) {
	var mu sync.Mutex
	var got []captured
	return func(level, msg string) {
			mu.Lock()
			defer mu.Unlock()
			got = append(got, captured{level, msg})
		}, func() []captured {
			mu.Lock()
			defer mu.Unlock()
			return append([]captured(nil), got...)
		}
}

func TestLogWriterSplitsAndJoinsLines(t *testing.T) {
	sink, lines := collect()
	w := newLogWriter(sink)

	// Две записи за один Write, пустая строка и CRLF.
	if _, err := w.Write([]byte("INFO[0000] a\nWARN[0000] b\n\r\nERROR[0000] c\r\n")); err != nil {
		t.Fatal(err)
	}
	// Запись, разорванная посреди строки.
	_, _ = w.Write([]byte("INFO[00"))
	_, _ = w.Write([]byte("00] d\nWARN"))
	_, _ = w.Write([]byte("[0001] e\n"))

	want := []captured{{"info", "a"}, {"warn", "b"}, {"error", "c"}, {"info", "d"}, {"warn", "e"}}
	got := lines()
	if len(got) != len(want) {
		t.Fatalf("строк %d, ожидалось %d: %v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("строка %d = %v, ожидалась %v", i, got[i], want[i])
		}
	}
}

func TestLogWriterFlushesOverlongLine(t *testing.T) {
	sink, lines := collect()
	w := newLogWriter(sink)
	_, _ = w.Write([]byte("INFO[0000] " + strings.Repeat("x", maxPendingLine)))
	if got := lines(); len(got) != 1 || got[0].level != "info" || len(got[0].msg) != maxPendingLine {
		t.Fatalf("строка без перевода строки не выдана: %d записей", len(got))
	}
}
