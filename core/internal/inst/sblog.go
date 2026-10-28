package inst

// sblog.go — журнал sing-box → журнал ядра (T-33, B2-12, D1-04). Без тега
// singbox_run: разбор строк и писатель не зависят от sing-box, раннер лишь
// передаёт писатель в box.Box.SetLogWritter (NEKO_PATCHES №3).

import (
	"bytes"
	"io"
	"regexp"
	"sync"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/logs"
)

// LogSink принимает строку журнала sing-box: уровень в терминах logs.Level*
// ("trace".."panic") и сообщение без префикса уровня и без ANSI.
type LogSink func(level, message string)

// LogSinker — раннер, умеющий пересылать собственный журнал (SingBoxRunner).
// api.NewServer подключает к такому раннеру журнал ядра.
type LogSinker interface {
	SetLogSink(sink LogSink)
}

// maxPendingLine — предел накопления строки без перевода строки.
const maxPendingLine = 64 << 10

// logLabel — «INFO[0000] …» либо «… INFO …» (при log.timestamp): метка уровня
// sing-box (log/format.go: верхний регистр) и необязательное «[секунды]».
var logLabel = regexp.MustCompile(`(?:^|\s)(PANIC|FATAL|ERROR|WARN|INFO|DEBUG|TRACE)(?:\[\d+\])?\s`)

// parseSingBoxLine разбирает одну строку журнала sing-box. Без метки уровня
// строка целиком уходит как info.
func parseSingBoxLine(line string) (level, message string) {
	line = logs.StripANSI(line)
	m := logLabel.FindStringSubmatchIndex(line)
	if m == nil {
		return logs.LevelInfo, line
	}
	switch line[m[2]:m[3]] {
	case "PANIC":
		level = logs.LevelPanic
	case "FATAL", "ERROR":
		level = logs.LevelError
	case "WARN":
		level = logs.LevelWarn
	case "DEBUG":
		level = logs.LevelDebug
	case "TRACE":
		level = logs.LevelTrace
	default:
		level = logs.LevelInfo
	}
	return level, line[m[1]:]
}

// logWriter — io.Writer для SetLogWritter: собирает байты в строки и отдаёт
// каждую в sink. sing-box пишет одну запись за вызов Write, но строки
// собираются и из частичных записей.
type logWriter struct {
	mu   sync.Mutex
	sink LogSink
	buf  []byte
}

func newLogWriter(sink LogSink) io.Writer { return &logWriter{sink: sink} }

func (w *logWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.buf = append(w.buf, p...)
	for {
		i := bytes.IndexByte(w.buf, '\n')
		if i < 0 {
			break
		}
		w.emit(w.buf[:i])
		w.buf = w.buf[i+1:]
	}
	if len(w.buf) > maxPendingLine {
		w.emit(w.buf)
		w.buf = nil
	}
	return len(p), nil
}

func (w *logWriter) emit(line []byte) {
	line = bytes.TrimRight(line, "\r")
	if len(line) == 0 {
		return
	}
	level, msg := parseSingBoxLine(string(line))
	w.sink(level, msg)
}
