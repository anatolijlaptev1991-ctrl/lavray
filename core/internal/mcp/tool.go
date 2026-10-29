// SPDX-License-Identifier: GPL-3.0-only

package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// ToolSpec — описание инструмента для tools/list.
type ToolSpec struct {
	Name        string
	Title       string
	Description string
	// InputSchema — JSON Schema входа (type=object).
	InputSchema map[string]any
	// Подсказки клиенту (annotations): инструмент только читает; может
	// необратимо изменить данные (обновление подписки заменяет список
	// серверов); повторный вызов с теми же аргументами ничего не меняет;
	// обращается к внешней сети.
	ReadOnly    bool
	Destructive bool
	Idempotent  bool
	OpenWorld   bool
	// Control — инструмент доступен только в режиме «чтение и управление».
	Control bool
}

// ToolResult — результат вызова: текст для модели и структура для клиента.
type ToolResult struct {
	Text       string
	Structured any
	IsError    bool
}

// textError — результат-ошибка инструмента (isError) с понятным текстом.
func textError(format string, args ...any) ToolResult {
	return ToolResult{Text: fmt.Sprintf(format, args...), IsError: true}
}

// Toolset — набор инструментов, которым управляет сервер.
type Toolset interface {
	// Specs — инструменты, видимые в текущем режиме доступа.
	Specs() []ToolSpec
	// Fingerprint меняется вместе со списком инструментов (режим доступа);
	// сервер по нему рассылает notifications/tools/list_changed.
	Fingerprint() string
	// Call выполняет инструмент. ErrUnknownTool и *ParamsError становятся
	// ошибками протокола (-32602), любой другой error — результатом isError.
	Call(ctx context.Context, name string, args json.RawMessage) (ToolResult, error)
}

// ErrUnknownTool — такого инструмента нет.
var ErrUnknownTool = errors.New("неизвестный инструмент")

// ParamsError — аргументы вызова не соответствуют схеме входа.
type ParamsError struct{ Msg string }

func (e *ParamsError) Error() string { return e.Msg }

// decodeArgs разбирает аргументы по схеме инструмента: лишние поля и
// неподходящие типы — ParamsError. Пустые аргументы равны `{}`.
func decodeArgs(raw json.RawMessage, into any) error {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		raw = []byte("{}")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		return &ParamsError{Msg: "неверные аргументы: " + err.Error()}
	}
	if dec.More() {
		return &ParamsError{Msg: "неверные аргументы: лишние данные после объекта"}
	}
	return nil
}

// flexInt — целое число, которое модели иногда присылают строкой («12»).
type flexInt int64

func (f *flexInt) UnmarshalJSON(b []byte) error {
	s := strings.Trim(strings.TrimSpace(string(b)), `"`)
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return fmt.Errorf("ожидалось целое число, получено %s", string(b))
	}
	*f = flexInt(n)
	return nil
}

// optInt — необязательное целое.
type optInt = *flexInt

// serverID проверяет идентификатор сервера.
func serverID(v flexInt) (int64, error) {
	if v < 1 {
		return 0, &ParamsError{Msg: "server_id должен быть положительным целым числом (см. list_servers)"}
	}
	return int64(v), nil
}

// obj — короткая запись объекта JSON Schema.
func obj(props map[string]any, required ...string) map[string]any {
	s := map[string]any{"type": "object", "properties": props, "additionalProperties": false}
	if len(required) > 0 {
		s["required"] = required
	}
	return s
}
