// SPDX-License-Identifier: GPL-3.0-only

package store

import (
	"context"
	"errors"
	"fmt"
)

// afterTableRestored вызывается после переноса каждой таблицы; тест подставляет
// сбой, чтобы проверить откат «посреди» восстановления.
var afterTableRestored = func(table string) error { return nil }

// Restore заменяет ВСЕ данные хранилища содержимым файла копии src (снятого
// Snapshot, возможно более старой версией схемы).
//
//  1. Копия проверяется и поднимается миграциями до текущей версии во
//     временной базе (withCopy): мусор, чужая SQLite и копия «из будущего»
//     отвергаются до любых изменений.
//  2. Копия подключается ATTACH к единственному соединению хранилища; в одной
//     транзакции BEGIN IMMEDIATE для каждой таблицы из sqlite_master
//     выполняются DELETE и INSERT по общим колонкам. Таблицы, добавленные
//     будущими миграциями, переносятся без правок этого кода.
//  3. Исключённые строки (backupExcluded, в первую очередь update.*) остаются
//     такими, какими были у получателя.
//  4. Внешние ключи проверяются до COMMIT; любая ошибка откатывает всё.
func (s *Store) Restore(ctx context.Context, src string) error {
	if s.tx != nil {
		return errors.New("store: Restore недоступен внутри InTx")
	}
	return s.withCopy(ctx, src, func(c *Store, path string, _ int64) error {
		// копия должна быть тихим файлом: Close сбрасывает WAL в основной файл
		if err := c.Close(); err != nil {
			return fmt.Errorf("store: закрытие копии: %w", err)
		}
		return s.replaceFrom(ctx, path)
	})
}

// replaceFrom — шаг 2–4 Restore над файлом поднятой копии.
func (s *Store) replaceFrom(ctx context.Context, copyPath string) (err error) {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("store: соединение для восстановления: %w", err)
	}
	defer func() { _ = conn.Close() }()
	if _, err := conn.ExecContext(ctx, `ATTACH DATABASE ? AS bk`, copyPath); err != nil {
		return fmt.Errorf("store: подключение копии: %w", err)
	}
	// откат и отключение не зависят от отмены ctx: иначе копия осталась бы
	// подключённой к соединению, а транзакция — открытой
	cleanup := context.WithoutCancel(ctx)
	inTx := false
	defer func() {
		if inTx {
			_, _ = conn.ExecContext(cleanup, `ROLLBACK`)
		}
		if _, derr := conn.ExecContext(cleanup, `DETACH DATABASE bk`); derr != nil && err == nil {
			err = fmt.Errorf("store: отключение копии: %w", derr)
		}
	}()

	tables, err := restoreTables(ctx, conn)
	if err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, `BEGIN IMMEDIATE`); err != nil {
		return fmt.Errorf("store: начало восстановления: %w", err)
	}
	inTx = true
	if _, err := conn.ExecContext(ctx, `PRAGMA defer_foreign_keys = ON`); err != nil {
		return fmt.Errorf("store: defer_foreign_keys: %w", err)
	}
	for _, table := range tables {
		if err := copyTable(ctx, conn, table); err != nil {
			return err
		}
		if err := afterTableRestored(table); err != nil {
			return err
		}
	}
	if err := copySequences(ctx, conn); err != nil {
		return err
	}
	if err := checkForeignKeys(ctx, conn); err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, `COMMIT`); err != nil {
		return fmt.Errorf("store: фиксация восстановления: %w", err)
	}
	inTx = false
	return nil
}
