// Package api — ConnectRPC-реализации контракта lavray.v1 (W6,
// core-port-plan §9 W6): Core/Profile(+Group)/Subscription/Routing/Dns/
// Settings — рабочие; Log/Stats/Connection/Diagnostics/Gateway/Update/
// WebSession — заглушки unimplemented (W7/W8), сервер с ними поднимается.
//
// recover-интерсептор (interceptors.go) гарантирует: паника хендлера —
// internal error, процесс ядра жив (THREAT-MODEL «паника ядра», LNB-13/32).
// Маппинг ошибок store/cfgbuild/subs → Connect-коды — errors.go.
package api

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/cfgbuild"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/inst"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/subs"
)

// mapErr — единый маппинг ошибок домена → Connect-коды. Хендлеры возвращают
// «сырые» ошибки; интерсептор прогоняет их через mapErr.
//
//	store.ErrNotFound        → NOT_FOUND
//	store.ErrLastGroup       → FAILED_PRECONDITION (FR-UI-107)
//	store.ErrConstraint      → INVALID_ARGUMENT (несуществующая группа и пр.)
//	cfgbuild.Error           → свой код (INVALID_ARGUMENT/FAILED_PRECONDITION
//	                           из allowlist/валидации, §3.1.1)
//	subs.ConfirmRequiredError→ FAILED_PRECONDITION (не в стриме — страховка)
//	inst.ErrAlreadyRunning   → FAILED_PRECONDITION
//	inst.ErrNotRunning       → FAILED_PRECONDITION
//	context.DeadlineExceeded → DEADLINE_EXCEEDED
//	прочее                   → INTERNAL
func mapErr(err error) error {
	if err == nil {
		return nil
	}
	if ce := new(connect.Error); errors.As(err, &ce) {
		return ce
	}
	var cfgErr *cfgbuild.Error
	if errors.As(err, &cfgErr) {
		return cfgErr.ConnectError()
	}
	switch {
	case errors.Is(err, store.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, store.ErrLastGroup):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, store.ErrConstraint):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, inst.ErrAlreadyRunning):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, inst.ErrNotRunning):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	}
	var confirm *subs.ConfirmRequiredError
	if errors.As(err, &confirm) {
		return connect.NewError(connect.CodeFailedPrecondition, err)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return connect.NewError(connect.CodeDeadlineExceeded, err)
	}
	if errors.Is(err, context.Canceled) {
		return connect.NewError(connect.CodeCanceled, err)
	}
	return connect.NewError(connect.CodeInternal, err)
}

// invalidArg — INVALID_ARGUMENT с человекочитаемым сообщением.
func invalidArg(format string, args ...any) error {
	return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf(format, args...))
}

// failedPrecondition — FAILED_PRECONDITION.
func failedPrecondition(format string, args ...any) error {
	return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf(format, args...))
}

// notFound — NOT_FOUND.
func notFound(format string, args ...any) error {
	return connect.NewError(connect.CodeNotFound, fmt.Errorf(format, args...))
}
