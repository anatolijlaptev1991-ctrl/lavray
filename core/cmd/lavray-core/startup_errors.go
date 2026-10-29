// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
)

// describeStoreError превращает ошибку store.Open в понятное сообщение для
// stderr и журнала (T-50, A1-15). Раньше ядро молча завершалось с кодом 1,
// и пользователь видел лишь «ядро не запустилось». Файл БД не меняется:
// автоматическая замена на пустую базу выглядела бы как тихая потеря всех
// профилей (FR-UI-260: «битый файл — понятная ошибка, не тихий сброс»).
func describeStoreError(dir string, err error) string {
	dbPath := store.DBPath(dir)
	name := filepath.Base(dbPath)
	var tooNew *store.SchemaTooNewError
	var corrupt *store.CorruptError
	switch {
	case errors.As(err, &tooNew):
		return fmt.Sprintf("lavray-core: база данных создана более новой версией LAVRay и не открыта.\n"+
			"  Файл:    %s\n"+
			"  Версия схемы в файле: v%d, эта сборка понимает до v%d.\n"+
			"Файл не изменён. Установите актуальную версию LAVRay. "+
			"Чтобы начать с чистой базы, переименуйте %s, %s-wal и %s-shm и запустите LAVRay снова.",
			dbPath, tooNew.Found, tooNew.Supported, name, name, name)
	case errors.As(err, &corrupt):
		return fmt.Sprintf("lavray-core: база данных повреждена и не открыта.\n"+
			"  Файл:    %s\n"+
			"  Причина: %v\n"+
			"Файл не изменён и не удалён. Что сделать:\n"+
			"  1. Закройте LAVRay.\n"+
			"  2. Если есть резервная копия, верните из неё файлы %s, %s-wal и %s-shm.\n"+
			"  3. Иначе переименуйте эти три файла в каталоге %s (например, добавьте суффикс .corrupt) "+
			"и запустите LAVRay снова: будет создана новая пустая база, профили и настройки придётся импортировать заново.",
			corrupt.Path, corrupt.Cause, name, name, name, dir)
	}
	return fmt.Sprintf("lavray-core: не удалось открыть базу данных в %s: %v", dir, err)
}

// oneLine — сообщение для журнала: без переводов строк и лишних пробелов.
func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }
