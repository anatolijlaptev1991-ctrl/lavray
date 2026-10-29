// SPDX-License-Identifier: GPL-3.0-only

// Package mcp — MCP-сервер LAVRay для ИИ-агентов (Claude Desktop, Claude
// Code, Cursor): JSON-RPC 2.0 по stdio, построчно (одно сообщение — одна
// строка). Протокол написан здесь, без внешних модулей. В stdout уходит только
// протокол, журнал — в stderr.
//
// Сервер не владеет состоянием: он подключается к уже запущенному приложению
// через сгенерированные ConnectRPC-клиенты с агентским токеном из
// agent-endpoint.json. Что разрешено агенту, решает ядро (internal/api/agent.go),
// здесь режим лишь определяет список инструментов.
package mcp

import "encoding/json"

// Версии протокола MCP, которые понимает сервер, от новой к старой. На
// initialize отвечаем запрошенной версией, если она поддержана, иначе самой
// новой (клиент решит, подходит ли ему).
var supportedVersions = []string{"2025-06-18", "2025-03-26", "2024-11-05"}

// Коды ошибок JSON-RPC.
const (
	codeParseError     = -32700
	codeInvalidRequest = -32600
	codeMethodNotFound = -32601
	codeInvalidParams  = -32602
	codeInternalError  = -32603
)

// request — входящее сообщение. Нет id — уведомление, ответа не будет.
type request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// isNotification — сообщение без id.
func (r *request) isNotification() bool { return len(r.ID) == 0 }

// rpcError — ошибка протокола JSON-RPC.
type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// response — ответ на запрос. ID копируется как есть (число или строка); для
// нечитаемого запроса ID = null.
type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

// notification — исходящее уведомление.
type notification struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
}

var nullID = json.RawMessage("null")

func errorResponse(id json.RawMessage, code int, msg string) response {
	if len(id) == 0 {
		id = nullID
	}
	return response{JSONRPC: "2.0", ID: id, Error: &rpcError{Code: code, Message: msg}}
}

func resultResponse(id json.RawMessage, result any) response {
	return response{JSONRPC: "2.0", ID: id, Result: result}
}
