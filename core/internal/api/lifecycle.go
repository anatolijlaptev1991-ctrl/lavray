// SPDX-License-Identifier: GPL-3.0-only

// lifecycle.go — остановка инстанса при выходе процесса ядра (T-52).
package api

import (
	"context"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/inst"
)

// StopInstance останавливает sing-box (TUN, маршруты, inbounds) и закрывает
// менеджер: Connect после этого невозможен. Тот же путь, что у RPC Shutdown
// (AUDIT §7.1.2: Close до выхода), для вызывающего вне RPC — выход по EOF
// stdin, по сигналу и после самого RPC. Ограничен inst.StopTimeout;
// повторный вызов — no-op.
func (s *Server) StopInstance(ctx context.Context) error {
	stopCtx, cancel := context.WithTimeout(ctx, inst.StopTimeout)
	defer cancel()
	return s.inst.Shutdown(stopCtx)
}
