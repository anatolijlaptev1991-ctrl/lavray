// SPDX-License-Identifier: GPL-3.0-only

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"time"
)

// Режимы доступа агентов, как в файле agent-endpoint.json.
const (
	ModeRead    = "read"
	ModeControl = "control"
)

// Пределы времени вызовов к ядру.
const (
	readTimeout    = 20 * time.Second
	connectTimeout = 75 * time.Second // ядро ждёт старта sing-box до 60 с
)

// handler выполняет инструмент поверх клиентов ядра.
type handler func(ctx context.Context, s *Session, args json.RawMessage) (ToolResult, error)

type tool struct {
	spec ToolSpec
	run  handler
}

// Tools — набор инструментов LAVRay. Каждый вызов заново читает файл адреса:
// ядро после перезапуска получает другой порт и токен, а режим доступа
// меняется без перезапуска MCP-сервера.
type Tools struct {
	endpointPath string
	all          []tool
	byName       map[string]tool

	mu      sync.Mutex
	cached  *Session // клиенты для адреса и токена cachedKey
	cachedK string
}

// NewTools создаёт набор; endpointPath — путь к agent-endpoint.json.
func NewTools(endpointPath string) *Tools {
	t := &Tools{endpointPath: endpointPath, byName: map[string]tool{}}
	t.all = append(readTools(), controlTools()...)
	for _, tl := range t.all {
		t.byName[tl.spec.Name] = tl
	}
	return t
}

// mode — режим из файла адреса; пусто, если приложения нет или доступ выключен.
func (t *Tools) mode() string {
	ep, err := ReadEndpoint(t.endpointPath)
	if err != nil {
		return ""
	}
	return ep.Mode
}

// Specs: в режиме управления видны все инструменты, в остальных состояниях
// (чтение, приложение не запущено, доступ выключен) — только чтение. Вызов
// невидимого инструмента всё равно получает понятный отказ.
func (t *Tools) Specs() []ToolSpec {
	control := t.mode() == ModeControl
	var out []ToolSpec
	for _, tl := range t.all {
		if tl.spec.Control && !control {
			continue
		}
		out = append(out, tl.spec)
	}
	return out
}

// Fingerprint — режим доступа: он определяет список инструментов.
func (t *Tools) Fingerprint() string { return "mode=" + t.mode() }

// session — клиенты ядра для адреса и токена из файла. Пока они не менялись,
// соединения переиспользуются; после перезапуска ядра (другой порт, другой
// токен) старые закрываются. Режим берётся из файла при каждом вызове.
func (t *Tools) session(ep Endpoint) (*Session, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	key := ep.URL + "\n" + ep.Token
	if t.cached == nil || t.cachedK != key {
		fresh, err := newSession(ep, filepath.Dir(t.endpointPath))
		if err != nil {
			return nil, err
		}
		if t.cached != nil {
			t.cached.transport.CloseIdleConnections()
		}
		t.cached, t.cachedK = fresh, key
	}
	sess := *t.cached
	sess.Mode = ep.Mode
	return &sess, nil
}

// Call выполняет инструмент.
func (t *Tools) Call(ctx context.Context, name string, args json.RawMessage) (ToolResult, error) {
	tl, ok := t.byName[name]
	if !ok {
		return ToolResult{}, ErrUnknownTool
	}
	ep, err := ReadEndpoint(t.endpointPath)
	if err != nil {
		return ToolResult{}, err
	}
	if tl.spec.Control && ep.Mode != ModeControl {
		return ToolResult{}, fmt.Errorf("инструмент %s доступен в режиме «чтение и управление»: включите его в LAVRay → Настройки → Агенты (MCP)", name)
	}
	sess, err := t.session(ep)
	if err != nil {
		return ToolResult{}, err
	}
	res, err := tl.run(ctx, sess, args)
	if err != nil {
		var perr *ParamsError
		if errors.As(err, &perr) {
			return ToolResult{}, err
		}
		return ToolResult{}, explain(err)
	}
	return res, nil
}
