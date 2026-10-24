package api

import (
	"context"
	"fmt"
	"runtime/debug"

	"connectrpc.com/connect"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/logs"
)

// Interceptor — обвязка ВСЕХ хендлеров сервера:
//
//  1. recover: паника хендлера (unary и стримингового) не убивает процесс
//     ядра — клиенту уходит INTERNAL, трейс — в лог-мультиплексор
//     (THREAT-MODEL «паника ядра», LNB-13/32; stack redact-нут по общим
//     правилам мультиплексора);
//  2. маппинг ошибок mapErr: хендлеры возвращают доменные ошибки как есть.
type interceptor struct {
	logs *logs.Mux
}

func newInterceptor(lg *logs.Mux) *interceptor { return &interceptor{logs: lg} }

func (i *interceptor) recoverLog(rcv any) {
	msg := fmt.Sprintf("ПАНИКА хендлера: %v", rcv)
	if i.logs != nil {
		// стек идёт в лог БЕЗ сырого вывода в stderr; redact применит Mux
		i.logs.Logf(logs.LevelError, logs.SourceAPI, "%s\n%s", msg, debug.Stack())
	}
}

// WrapUnary — unary-вызовы.
func (i *interceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (resp connect.AnyResponse, err error) {
		defer func() {
			if r := recover(); r != nil {
				i.recoverLog(r)
				resp = nil
				err = connect.NewError(connect.CodeInternal,
					fmt.Errorf("внутренняя ошибка ядра (паника обработана); подробности в журнале"))
			}
		}()
		resp, err = next(ctx, req)
		err = mapErr(err)
		return resp, err
	}
}

// WrapStreamingHandler — серверные стримы.
func (i *interceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) (err error) {
		defer func() {
			if r := recover(); r != nil {
				i.recoverLog(r)
				err = connect.NewError(connect.CodeInternal,
					fmt.Errorf("внутренняя ошибка ядра (паника обработана); подробности в журнале"))
			}
		}()
		err = mapErr(next(ctx, conn))
		return err
	}
}

// WrapStreamingClient — клиентские стримы (сервером не используются;
// нужен для интерфейса connect.Interceptor).
func (i *interceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return func(ctx context.Context, spec connect.Spec) connect.StreamingClientConn {
		return next(ctx, spec)
	}
}

var _ connect.Interceptor = (*interceptor)(nil)
