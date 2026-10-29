// SPDX-License-Identifier: GPL-3.0-only

package mcp

import (
	"fmt"
	"strings"
	"time"
	"unicode"

	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
)

// Пределы текстов, которые попадают в ответ модели. Имена серверов, групп и
// строки журнала приходят извне (провайдер подписки, удалённые узлы) и могут
// содержать чужие инструкции: длина и управляющие символы ограничены.
const (
	maxNameRunes = 80
	maxLogRunes  = 300
)

// cleanText сворачивает пробелы и переводы строк, убирает управляющие символы
// и обрезает текст до max рун.
func cleanText(s string, max int) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, s)
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > max {
		return string(r[:max]) + "…"
	}
	return s
}

// isoTime — момент в виде RFC 3339 (UTC); nil при отсутствии времени.
func isoTime(ms int64) *string {
	if ms <= 0 {
		return nil
	}
	t := time.UnixMilli(ms).UTC().Format(time.RFC3339)
	return &t
}

// humanBytes — размер для текста ответа.
func humanBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d Б", n)
	}
	div, exp := int64(unit), 0
	for m := n / unit; m >= unit && exp < 4; m /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cиБ", float64(n)/float64(div), "КМГТП"[exp])
}

// protocolName — протокол сервера в нижнем регистре: vless, trojan, hysteria2.
func protocolName(t lavrayv1.ProfileType) string {
	return strings.ToLower(strings.TrimPrefix(t.String(), "PROFILE_TYPE_"))
}

// stateName — состояние ядра: idle, connecting, connected, …
func stateName(s lavrayv1.CoreState) string {
	return strings.ToLower(strings.TrimPrefix(s.String(), "CORE_STATE_"))
}

// connModeName — режим подключения: system_proxy, tun.
func connModeName(m lavrayv1.ConnectMode) string {
	switch m {
	case lavrayv1.ConnectMode_CONNECT_MODE_SYSTEM_PROXY:
		return "system_proxy"
	case lavrayv1.ConnectMode_CONNECT_MODE_TUN:
		return "tun"
	}
	return ""
}

// connModeText — режим подключения словами для текста ответа.
func connModeText(m lavrayv1.ConnectMode) string {
	switch m {
	case lavrayv1.ConnectMode_CONNECT_MODE_SYSTEM_PROXY:
		return "системный прокси"
	case lavrayv1.ConnectMode_CONNECT_MODE_TUN:
		return "TUN"
	}
	return "—"
}

// Классы результата последнего теста сервера.
const (
	testOK       = "ok"
	testFailed   = "failed"
	testNA       = "n/a"
	testUntested = "untested"
)

// testClass разбирает результат теста (ядро оставляет для агента только класс
// ошибки: «failed» или «n/a»).
func testClass(tr *lavrayv1.TestResult) (class string, latencyMs *int32) {
	switch {
	case tr == nil:
		return testUntested, nil
	case tr.GetLastError() == testNA:
		return testNA, nil
	case tr.GetLastError() != "", tr.LatencyMs != nil && tr.GetLatencyMs() < 0:
		return testFailed, nil
	case tr.GetLatencyMs() > 0:
		ms := tr.GetLatencyMs()
		return testOK, &ms
	}
	return testUntested, nil
}
