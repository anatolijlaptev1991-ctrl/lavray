// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"connectrpc.com/connect"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/api"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
)

// runImportNekoBox — подкоманда `lavray-core import-nekobox --data D --from P
// [--dry-run] [--no-routes] [--no-settings]`: перенос из NekoBox без запуска
// ядра. Источник только читается, NekoBox не трогается. Отчёт — JSON в stdout,
// ошибки — в stderr. Код: 0 — готово, 1 — перенос не удался, 2 — неверные флаги.
//
// Работать лучше при закрытом приложении: оно держит наборы и настройки в
// памяти и увидит перенесённое только после перезапуска.
func runImportNekoBox(args []string, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("import-nekobox", flag.ContinueOnError)
	fs.SetOutput(errOut)
	data := fs.String("data", defaultDataDir(), "каталог данных LAVRay")
	from := fs.String("from", "", "каталог config NekoBox (или каталог установки с config)")
	dry := fs.Bool("dry-run", false, "только посчитать, ничего не записывать (работает с копией базы)")
	noRoutes := fs.Bool("no-routes", false, "не переносить маршруты")
	noSettings := fs.Bool("no-settings", false, "не переносить настройки")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 {
		return 2
	}
	if *from == "" {
		fmt.Fprintln(errOut, "--from обязателен: каталог config NekoBox")
		return 2
	}
	source, err := filepath.Abs(*from) // командная строка принимает и относительный путь
	if err != nil {
		fmt.Fprintln(errOut, err)
		return 2
	}
	if err := api.ValidateNekoBoxPath(source); err != nil {
		fmt.Fprintln(errOut, importErrMessage(err)) // до открытия базы: пустой lavray.db не создаётся
		return 1
	}
	dir, cleanup, err := dataDirFor(*data, *dry)
	if err != nil {
		fmt.Fprintln(errOut, err)
		return 1
	}
	defer cleanup()
	st, err := store.Open(dir)
	if err != nil {
		fmt.Fprintln(errOut, describeStoreError(dir, err))
		return 1
	}
	defer func() { _ = st.Close() }()
	rep, err := api.RunNekoBoxImport(st, source, api.NekoRunOptions{Routes: !*noRoutes, Settings: !*noSettings, DryRun: *dry})
	if err != nil {
		fmt.Fprintln(errOut, importErrMessage(err))
		return 1
	}
	enc := json.NewEncoder(out)
	enc.SetIndent("", "  ")
	if err := enc.Encode(rep); err != nil {
		fmt.Fprintln(errOut, err)
		return 1
	}
	return 0
}

// dataDirFor — каталог данных для переноса. Сухой прогон ничего не пишет в
// настоящую базу, даже миграции и закрытие «висящих» сессий, которые делает
// store.Open: он работает с копией базы (файл и -wal) во временном каталоге, а
// если базы ещё нет — с пустой временной.
func dataDirFor(data string, dry bool) (dir string, cleanup func(), err error) {
	if !dry {
		return data, func() {}, nil
	}
	tmp, err := os.MkdirTemp("", "lavray-import-dry-*")
	if err != nil {
		return "", nil, err
	}
	cleanup = func() { _ = os.RemoveAll(tmp) }
	src := store.DBPath(data)
	for _, suffix := range []string{"", "-wal"} {
		if err := copyIfExists(src+suffix, store.DBPath(tmp)+suffix); err != nil {
			cleanup()
			return "", nil, fmt.Errorf("копия базы для сухого прогона: %w", err)
		}
	}
	return tmp, cleanup, nil
}

// copyIfExists копирует файл src в dst; нет src — не ошибка.
func copyIfExists(src, dst string) error {
	in, err := os.Open(src)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

// importErrMessage — текст ошибки без кода Connect («invalid_argument: …»).
func importErrMessage(err error) string {
	var ce *connect.Error
	if errors.As(err, &ce) {
		return ce.Message()
	}
	return err.Error()
}
