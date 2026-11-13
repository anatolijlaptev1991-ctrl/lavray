// SPDX-License-Identifier: GPL-3.0-only

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"

	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
)

// Пределы управляющих инструментов.
const (
	maxTestServers        = 500
	maxTestResultsShown   = 200
	defaultTestTimeoutSec = 60
	maxTestTimeoutSec     = 300
	updateTimeout         = 180 * time.Second
	// uiStateFile — файл общих настроек окна рядом с agent-endpoint.json; из него
	// берётся сервер, выбранный пользователем в приложении.
	uiStateFile = "ui-state.json"
	uiServerKey = "lavray.server"
)

func controlTools() []tool {
	serverIDProp := func(desc string) map[string]any {
		return map[string]any{"type": "integer", "minimum": 1, "description": desc}
	}
	return []tool{
		{spec: ToolSpec{
			Name:  "connect",
			Title: "Connect",
			Description: "Connects LAVRay to a server. Without server_id it uses the server currently selected in the " +
				"app (or the first one). The connection mode (system proxy or TUN) is the one chosen in the app; " +
				"in system proxy mode the app window also sets the system proxy (Windows, GNOME or KDE). This changes the user's network " +
				"traffic: use only when the user asked for it. Does nothing if already connected to that server.",
			InputSchema: obj(map[string]any{
				"server_id": serverIDProp("Server id from list_servers (optional)."),
			}),
			Idempotent: true,
			Control:    true,
		}, run: connectTool},
		{spec: ToolSpec{
			Name:        "disconnect",
			Title:       "Disconnect",
			Description: "Disconnects LAVRay (the app also removes the system proxy it set). Use only when the user asked for it.",
			InputSchema: obj(map[string]any{}),
			Idempotent:  true,
			Control:     true,
		}, run: disconnectTool},
		{spec: ToolSpec{
			Name:  "switch_server",
			Title: "Switch server",
			Description: "Reconnects to another server: disconnects and connects to server_id. If the new server " +
				"does not start, the previous one is restored. When not connected it behaves like connect.",
			InputSchema: obj(map[string]any{
				"server_id": serverIDProp("Server id from list_servers."),
			}, "server_id"),
			Idempotent: true,
			Control:    true,
		}, run: switchServerTool},
		{spec: ToolSpec{
			Name:  "test_servers",
			Title: "Test servers",
			Description: "Measures servers and waits until the test finishes (or timeout_seconds passes). " +
				"mode=latency is a TCP connection time to the server; mode=url sends a request through each server " +
				"to the test URL set in the app. Tests all servers unless server_ids is given. Updates the results " +
				"shown by list_servers.",
			InputSchema: obj(map[string]any{
				"mode": map[string]any{"type": "string", "enum": []string{"latency", "url"}, "default": "latency", "description": "latency (TCP ping) or url (request through the server)."},
				"server_ids": map[string]any{
					"type": "array", "items": map[string]any{"type": "integer", "minimum": 1},
					"maxItems": maxTestServers, "description": "Server ids to test (default: all).",
				},
				"timeout_seconds": map[string]any{"type": "integer", "minimum": 5, "maximum": maxTestTimeoutSec, "default": defaultTestTimeoutSec, "description": "How long to wait for the whole test."},
			}),
			Idempotent: true,
			OpenWorld:  true,
			Control:    true,
		}, run: testServersTool},
		{spec: ToolSpec{
			Name:  "update_subscriptions",
			Title: "Update subscriptions",
			Description: "Downloads the current server list of one subscription (id) or of all active subscriptions " +
				"and waits for the result. The server list of a subscription is replaced. If an update would remove " +
				"many servers it is not applied: confirmation is only possible in the app.",
			InputSchema: obj(map[string]any{
				"id": serverIDProp("Subscription id from list_subscriptions (optional; default: all)."),
			}),
			Destructive: true,
			Idempotent:  true,
			OpenWorld:   true,
			Control:     true,
		}, run: updateSubscriptionsTool},
	}
}

// ---- выбор сервера ---------------------------------------------------------

func listAllProfiles(ctx context.Context, s *Session) ([]*lavrayv1.Profile, error) {
	ctx, cancel := context.WithTimeout(ctx, readTimeout)
	defer cancel()
	res, err := s.Profile.ListProfiles(ctx, connect.NewRequest(&lavrayv1.ListProfilesRequest{}))
	if err != nil {
		return nil, err
	}
	return res.Msg.Profiles, nil
}

var reDigits = regexp.MustCompile(`^[1-9]\d{0,18}$`)

// selectedInApp — сервер, выбранный пользователем в окне (ui-state.json).
// 0 — выбора нет или файл не читается.
func selectedInApp(dir string) int64 {
	raw, err := os.ReadFile(filepath.Join(dir, uiStateFile))
	if err != nil || len(raw) > 128<<10 {
		return 0
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return 0
	}
	v, _ := m[uiServerKey].(string)
	if !reDigits.MatchString(v) {
		return 0
	}
	id, _ := strconv.ParseInt(v, 10, 64)
	return id
}

// pickServer: заданный id (его обязан быть в списке), иначе выбранный в
// приложении, иначе первый.
func pickServer(profiles []*lavrayv1.Profile, wanted *flexInt, dir string) (*lavrayv1.Profile, error) {
	if len(profiles) == 0 {
		return nil, errors.New("в LAVRay нет ни одного сервера: добавьте сервер или подписку в приложении")
	}
	if wanted != nil {
		id, err := serverID(*wanted)
		if err != nil {
			return nil, err
		}
		for _, p := range profiles {
			if p.Id == id {
				return p, nil
			}
		}
		return nil, fmt.Errorf("сервера с id %d нет: список — инструмент list_servers", id)
	}
	if id := selectedInApp(dir); id > 0 {
		for _, p := range profiles {
			if p.Id == id {
				return p, nil
			}
		}
	}
	return profiles[0], nil
}

func serverLabel(p *lavrayv1.Profile) string {
	return fmt.Sprintf("«%s» (id %d)", cleanText(p.Name, maxNameRunes), p.Id)
}

// ---- connect ---------------------------------------------------------------

func startConnect(ctx context.Context, s *Session, id int64) error {
	ctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()
	_, err := s.Core.Connect(ctx, connect.NewRequest(&lavrayv1.ConnectRequest{ProfileId: &id}))
	return err
}

func startDisconnect(ctx context.Context, s *Session) error {
	ctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()
	_, err := s.Core.Disconnect(ctx, connect.NewRequest(&lavrayv1.DisconnectRequest{}))
	return err
}

// connectedResult — ответ после подключения: новое состояние ядра.
func connectedResult(ctx context.Context, s *Session, lead string) (ToolResult, error) {
	st, err := fetchStatus(ctx, s)
	if err != nil {
		return ToolResult{}, err
	}
	view, text := statusView(st, s.Mode, time.Now())
	if st.GetState() == lavrayv1.CoreState_CORE_STATE_CONNECTED && st.GetMode() == lavrayv1.ConnectMode_CONNECT_MODE_SYSTEM_PROXY {
		text += " Системный прокси применит окно LAVRay."
	}
	return ToolResult{Text: strings.TrimSpace(lead + " " + text), Structured: view}, nil
}

func connectTool(ctx context.Context, s *Session, args json.RawMessage) (ToolResult, error) {
	var a struct {
		ServerID optInt `json:"server_id"`
	}
	if err := decodeArgs(args, &a); err != nil {
		return ToolResult{}, err
	}
	st, err := fetchStatus(ctx, s)
	if err != nil {
		return ToolResult{}, err
	}
	profiles, err := listAllProfiles(ctx, s)
	if err != nil {
		return ToolResult{}, err
	}
	target, err := pickServer(profiles, a.ServerID, s.Dir)
	if err != nil {
		return textError("%s", err.Error()), nil
	}
	switch st.GetState() {
	case lavrayv1.CoreState_CORE_STATE_CONNECTED:
		if st.GetActiveProfileId() == target.Id || a.ServerID == nil {
			return connectedResult(ctx, s, "Уже подключено.")
		}
		return textError("Уже подключено к «%s» (id %d). Чтобы сменить сервер, используйте switch_server, чтобы отключиться — disconnect.",
			cleanText(st.GetActiveProfileName(), maxNameRunes), st.GetActiveProfileId()), nil
	case lavrayv1.CoreState_CORE_STATE_CONNECTING, lavrayv1.CoreState_CORE_STATE_DISCONNECTING, lavrayv1.CoreState_CORE_STATE_RECONNECTING:
		return textError("LAVRay сейчас занят (состояние: %s): повторите через несколько секунд.", stateName(st.GetState())), nil
	}
	if err := startConnect(ctx, s, target.Id); err != nil {
		return ToolResult{}, err
	}
	return connectedResult(ctx, s, "")
}

// ---- disconnect ------------------------------------------------------------

func disconnectTool(ctx context.Context, s *Session, args json.RawMessage) (ToolResult, error) {
	if err := decodeArgs(args, &struct{}{}); err != nil {
		return ToolResult{}, err
	}
	st, err := fetchStatus(ctx, s)
	if err != nil {
		return ToolResult{}, err
	}
	if st.GetState() == lavrayv1.CoreState_CORE_STATE_IDLE {
		view, text := statusView(st, s.Mode, time.Now())
		return ToolResult{Text: "Уже отключено. " + text, Structured: view}, nil
	}
	if err := startDisconnect(ctx, s); err != nil {
		return ToolResult{}, err
	}
	after, err := fetchStatus(ctx, s)
	if err != nil {
		return ToolResult{}, err
	}
	view, text := statusView(after, s.Mode, time.Now())
	return ToolResult{Text: "Отключено. " + text, Structured: view}, nil
}

// ---- switch_server ---------------------------------------------------------

func switchServerTool(ctx context.Context, s *Session, args json.RawMessage) (ToolResult, error) {
	var a struct {
		ServerID *flexInt `json:"server_id"`
	}
	if err := decodeArgs(args, &a); err != nil {
		return ToolResult{}, err
	}
	if a.ServerID == nil {
		return ToolResult{}, &ParamsError{Msg: "нужен server_id (см. list_servers)"}
	}
	st, err := fetchStatus(ctx, s)
	if err != nil {
		return ToolResult{}, err
	}
	profiles, err := listAllProfiles(ctx, s)
	if err != nil {
		return ToolResult{}, err
	}
	target, err := pickServer(profiles, a.ServerID, s.Dir)
	if err != nil {
		return textError("%s", err.Error()), nil
	}
	connected := st.GetState() == lavrayv1.CoreState_CORE_STATE_CONNECTED
	switch st.GetState() {
	case lavrayv1.CoreState_CORE_STATE_CONNECTING, lavrayv1.CoreState_CORE_STATE_DISCONNECTING, lavrayv1.CoreState_CORE_STATE_RECONNECTING:
		return textError("LAVRay сейчас занят (состояние: %s): повторите через несколько секунд.", stateName(st.GetState())), nil
	}
	if connected && st.GetActiveProfileId() == target.Id {
		return connectedResult(ctx, s, "Уже подключено к этому серверу.")
	}
	prev := st.GetActiveProfileId()
	if connected {
		if err := startDisconnect(ctx, s); err != nil {
			return ToolResult{}, err
		}
	}
	if err := startConnect(ctx, s, target.Id); err != nil {
		reason := explain(err)
		// Прежнее соединение возвращаем, как делает окно при неудачной смене.
		if connected && prev > 0 {
			if back := startConnect(ctx, s, prev); back == nil {
				return textError("Не удалось подключиться к %s: %s. Прежний сервер (id %d) подключён снова.", serverLabel(target), reason, prev), nil
			}
			return textError("Не удалось подключиться к %s: %s. Прежний сервер (id %d) вернуть тоже не удалось — LAVRay отключён.", serverLabel(target), reason, prev), nil
		}
		return textError("Не удалось подключиться к %s: %s.", serverLabel(target), reason), nil
	}
	return connectedResult(ctx, s, "Переключено на "+serverLabel(target)+".")
}

// ---- test_servers ----------------------------------------------------------

func testServersTool(ctx context.Context, s *Session, args json.RawMessage) (ToolResult, error) {
	var a struct {
		Mode           string    `json:"mode"`
		ServerIDs      []flexInt `json:"server_ids"`
		TimeoutSeconds optInt    `json:"timeout_seconds"`
	}
	if err := decodeArgs(args, &a); err != nil {
		return ToolResult{}, err
	}
	mode := lavrayv1.TestLatencyRequest_MODE_TCP_PING
	switch a.Mode {
	case "", "latency":
	case "url":
		mode = lavrayv1.TestLatencyRequest_MODE_URL_TEST
	default:
		return ToolResult{}, &ParamsError{Msg: `mode: допустимо "latency" или "url"`}
	}
	timeout := time.Duration(defaultTestTimeoutSec) * time.Second
	if a.TimeoutSeconds != nil {
		sec := int64(*a.TimeoutSeconds)
		if sec < 5 || sec > maxTestTimeoutSec {
			return ToolResult{}, &ParamsError{Msg: fmt.Sprintf("timeout_seconds должен быть от 5 до %d", maxTestTimeoutSec)}
		}
		timeout = time.Duration(sec) * time.Second
	}
	if len(a.ServerIDs) > maxTestServers {
		return ToolResult{}, &ParamsError{Msg: fmt.Sprintf("server_ids: не больше %d серверов за раз", maxTestServers)}
	}

	profiles, err := listAllProfiles(ctx, s)
	if err != nil {
		return ToolResult{}, err
	}
	names := make(map[int64]string, len(profiles))
	for _, p := range profiles {
		names[p.Id] = p.Name
	}
	var ids []int64
	if len(a.ServerIDs) == 0 {
		for _, p := range profiles {
			if len(ids) >= maxTestServers {
				break
			}
			ids = append(ids, p.Id)
		}
	} else {
		for _, v := range a.ServerIDs {
			id, err := serverID(v)
			if err != nil {
				return ToolResult{}, err
			}
			if _, ok := names[id]; !ok {
				return textError("Сервера с id %d нет: список — инструмент list_servers.", id), nil
			}
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return textError("В LAVRay нет ни одного сервера для проверки."), nil
	}

	tctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	stream, err := s.Profile.TestLatency(tctx, connect.NewRequest(&lavrayv1.TestLatencyRequest{ProfileIds: ids, Mode: mode}))
	if err != nil {
		return ToolResult{}, err
	}
	defer stream.Close()
	results := map[int64]*lavrayv1.TestResult{}
	for stream.Receive() {
		m := stream.Msg()
		results[m.ProfileId] = m.Result
	}
	streamErr := stream.Err()
	timedOut := errors.Is(tctx.Err(), context.DeadlineExceeded)
	if timedOut || (streamErr != nil && ctx.Err() != nil) {
		// Остановить тест в ядре: оно считает отмену обрывом стрима, но батч
		// мог ещё держать тестовые инстансы.
		stop, stopCancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, _ = s.Profile.StopTests(stop, connect.NewRequest(&lavrayv1.StopTestsRequest{}))
		stopCancel()
	}
	if streamErr != nil && !timedOut {
		if ctx.Err() != nil {
			return ToolResult{}, ctx.Err()
		}
		return ToolResult{}, streamErr
	}
	return testSummary(a.Mode, ids, names, results, timedOut), nil
}

// testSummary — итог теста серверов: счётчики и список лучших.
func testSummary(mode string, ids []int64, names map[int64]string, results map[int64]*lavrayv1.TestResult, timedOut bool) ToolResult {
	if mode == "" {
		mode = "latency"
	}
	type row struct {
		id      int64
		name    string
		class   string
		latency *int32
	}
	var rows []row
	ok, failed, na := 0, 0, 0
	for _, id := range ids {
		tr, done := results[id]
		if !done {
			continue
		}
		class, latency := testClass(tr)
		switch class {
		case testOK:
			ok++
		case testNA:
			na++
		default:
			failed++
		}
		rows = append(rows, row{id: id, name: cleanText(names[id], maxNameRunes), class: class, latency: latency})
	}
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		switch {
		case (a.latency != nil) != (b.latency != nil):
			return a.latency != nil
		case a.latency != nil:
			return *a.latency < *b.latency
		}
		return false
	})
	shown := rows
	if len(shown) > maxTestResultsShown {
		shown = shown[:maxTestResultsShown]
	}
	items := make([]map[string]any, 0, len(shown))
	var text strings.Builder
	fmt.Fprintf(&text, "Проверено %d из %d серверов (режим: %s): доступно %d, недоступно %d", len(rows), len(ids), mode, ok, failed)
	if na > 0 {
		fmt.Fprintf(&text, ", не применимо %d", na)
	}
	text.WriteString(".")
	if timedOut {
		text.WriteString(" Время ожидания вышло, тест остановлен — результаты неполные.")
	}
	for i, r := range shown {
		item := map[string]any{"id": r.id, "name": r.name, "status": r.class}
		if r.latency != nil {
			item["latency_ms"] = *r.latency
		}
		items = append(items, item)
		if i < 30 {
			fmt.Fprintf(&text, "\n%d | %s | %s", r.id, r.name, latencyText(r.class, r.latency))
		}
	}
	if len(shown) > 30 {
		fmt.Fprintf(&text, "\n… остальные — в structuredContent (%d)", len(shown))
	}
	return ToolResult{
		Text: text.String(),
		Structured: map[string]any{
			"mode": mode, "requested": len(ids), "completed": len(rows), "ok": ok, "failed": failed, "not_applicable": na,
			"timed_out": timedOut, "truncated": len(rows) > len(shown), "results": items,
		},
	}
}

// ---- update_subscriptions --------------------------------------------------

func updateSubscriptionsTool(ctx context.Context, s *Session, args json.RawMessage) (ToolResult, error) {
	var a struct {
		ID optInt `json:"id"`
	}
	if err := decodeArgs(args, &a); err != nil {
		return ToolResult{}, err
	}
	groups, err := fetchSubscriptions(ctx, s)
	if err != nil {
		return ToolResult{}, err
	}
	var targets, skipped []*lavrayv1.Group
	if a.ID != nil {
		id, err := serverID(*a.ID)
		if err != nil {
			return ToolResult{}, &ParamsError{Msg: "id должен быть положительным целым числом (см. list_subscriptions)"}
		}
		for _, g := range groups {
			if g.Id == id {
				targets = append(targets, g)
			}
		}
		if len(targets) == 0 {
			return textError("Подписки с id %d нет: список — инструмент list_subscriptions.", id), nil
		}
	} else {
		for _, g := range groups {
			if g.Archive || g.SkipAutoUpdate {
				skipped = append(skipped, g) // как «Обновить все» в приложении
				continue
			}
			targets = append(targets, g)
		}
	}
	if len(targets) == 0 {
		return textError("Нет подписок для обновления."), nil
	}

	uctx, cancel := context.WithTimeout(ctx, updateTimeout)
	defer cancel()
	var items []map[string]any
	counts := map[string]int{}
	for _, g := range targets {
		item := updateOne(uctx, s, g)
		counts[item["status"].(string)]++
		items = append(items, item)
	}
	for _, g := range skipped {
		counts["skipped"]++
		items = append(items, map[string]any{"id": g.Id, "name": cleanText(g.Name, maxNameRunes), "status": "skipped"})
	}

	var text strings.Builder
	fmt.Fprintf(&text, "Подписок: %d; обновлено %d, ошибок %d, требуют подтверждения в приложении %d, пропущено %d.",
		len(items), counts["updated"], counts["failed"], counts["confirm_required"], counts["skipped"])
	for _, it := range items {
		fmt.Fprintf(&text, "\n%v | %v | %v", it["id"], it["name"], it["status"])
		if e, ok := it["error"]; ok {
			fmt.Fprintf(&text, " | %v", e)
		}
	}
	return ToolResult{Text: text.String(), Structured: map[string]any{"subscriptions": items}}, nil
}

// updateOne обновляет одну подписку и описывает итог.
func updateOne(ctx context.Context, s *Session, g *lavrayv1.Group) map[string]any {
	item := map[string]any{"id": g.Id, "name": cleanText(g.Name, maxNameRunes), "status": "failed"}
	stream, err := s.Subs.UpdateSubscription(ctx, connect.NewRequest(&lavrayv1.UpdateSubscriptionRequest{GroupId: g.Id}))
	if err != nil {
		item["error"] = explain(err).Error()
		return item
	}
	defer stream.Close()
	status := ""
	for stream.Receive() {
		m := stream.Msg()
		switch m.Phase {
		case lavrayv1.SubscriptionProgress_PHASE_DIFFING:
			item["added"] = m.GetAddedCount()
			item["removed"] = m.GetRemovedCount()
			item["servers_total"] = m.GetTotalCount()
		case lavrayv1.SubscriptionProgress_PHASE_DONE:
			status = "updated"
		case lavrayv1.SubscriptionProgress_PHASE_CONFIRM_REQUIRED:
			status = "confirm_required"
			item["would_remove"] = m.GetWouldRemoveCount()
			item["error"] = "обновление удалило бы много серверов: подтвердите его в приложении"
		case lavrayv1.SubscriptionProgress_PHASE_FAILED:
			status = "failed"
			if d := m.GetDetail(); d != "" {
				item["error"] = cleanText(d, 200)
			}
		}
	}
	if err := stream.Err(); err != nil {
		if status == "" || status == "updated" {
			status = "failed"
		}
		if _, has := item["error"]; !has {
			item["error"] = explain(err).Error()
		}
	}
	if status == "" {
		status = "failed"
		item["error"] = "ядро не сообщило результат"
	}
	item["status"] = status
	return item
}
