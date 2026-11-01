// SPDX-License-Identifier: GPL-3.0-only

// update_comp_errors.go — раскладка ошибок доставки пресетов и гео по Connect-
// кодам и причинам verify_failed (T-75/7.5). Нарушение целостности или
// безопасности артефакта — событие verify_failed с причиной и очисткой staging
// (как у приложения); состояние (нет прошлой ревизии, каталог занят) — ошибка
// вызова FAILED_PRECONDITION с причиной в начале сообщения.
package api

import (
	"errors"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// Причины FAILED_PRECONDITION у Rollback/ApplyUpdates для данных.
const (
	ReasonNoPrevious = "no_previous"
	ReasonDirBusy    = "dir_busy"
)

// componentFailReason — причина verify_failed для ошибки загрузки/применения
// артефакта данных ("" — не нарушение целостности, а сбой окружения).
func componentFailReason(err error) string {
	switch {
	case errors.Is(err, updates.ErrHashMismatch):
		return "sha256_mismatch"
	case errors.Is(err, updates.ErrLengthMismatch):
		return "truncated"
	case errors.Is(err, updates.ErrTooLarge):
		return "too_large"
	case errors.Is(err, updates.ErrPresetNotNewer):
		return "not_newer"
	case errors.Is(err, updates.ErrPresetRejected):
		return "preset_rejected"
	case errors.Is(err, updates.ErrArchiveEntry):
		return "archive_unsafe"
	case errors.Is(err, updates.ErrArchiveLimit):
		return "archive_limits"
	case errors.Is(err, updates.ErrGeoIncomplete):
		return "geo_incomplete"
	case errors.Is(err, updates.ErrGeoInvalid):
		return "geo_invalid"
	}
	return ""
}

// componentStateErr — ошибки состояния применения и отката данных.
func componentStateErr(err error) error {
	switch {
	case errors.Is(err, updates.ErrNoPrevious):
		return reasonError(ReasonNoPrevious, "прошлой ревизии нет: откатываться не к чему")
	case errors.Is(err, updates.ErrDirBusy):
		return reasonError(ReasonDirBusy, "каталог занят (работающее соединение держит файлы): отключитесь и повторите: %v", err)
	}
	return mapErr(err)
}
