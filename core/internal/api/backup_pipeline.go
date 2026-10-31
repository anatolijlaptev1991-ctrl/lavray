// SPDX-License-Identifier: GPL-3.0-only

package api

// backup_pipeline.go — сборка и разбор файла копии: снимок БД ↔ контейнер ↔
// шифр. Файлы живут во временном каталоге внутри каталога данных и удаляются
// сразу; снимок содержит секреты открытым текстом, как и сама lavray.db.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"connectrpc.com/connect"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/backup"
)

// snapshotFile — имя файла снимка во временном каталоге.
const snapshotFile = "snapshot.db"

// tempDir создаёт временный каталог операции; cleanup удаляет его с повторами
// (на Windows хэндлы SQLite закрываются с задержкой).
func (b *backupService) tempDir() (dir string, cleanup func(), err error) {
	dir, err = os.MkdirTemp(b.srv.st.Dir(), "backup-")
	if err != nil {
		return "", nil, fmt.Errorf("временный каталог копии: %w", err)
	}
	return dir, func() { removeTempDir(dir) }, nil
}

func removeTempDir(dir string) {
	for i := 0; i < 50; i++ {
		if os.RemoveAll(dir) == nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// buildBackup снимает БД, проверяет снимок и возвращает зашифрованный файл.
func (b *backupService) buildBackup(ctx context.Context, password string) ([]byte, summaryDoc, error) {
	dir, cleanup, err := b.tempDir()
	if err != nil {
		return nil, summaryDoc{}, err
	}
	defer cleanup()
	path := filepath.Join(dir, snapshotFile)
	st := b.srv.st
	if err := st.Snapshot(ctx, path); err != nil {
		return nil, summaryDoc{}, err
	}
	info, err := st.InspectCopy(ctx, path) // снимок открывается сам: проверка до шифрования
	if err != nil {
		return nil, summaryDoc{}, fmt.Errorf("проверка снимка: %w", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, summaryDoc{}, err
	}
	doc := newSummaryDoc(b.srv.appVersion, b.now().UnixMilli(), info)
	summary, err := json.Marshal(doc)
	if err != nil {
		return nil, summaryDoc{}, err
	}
	body, err := backup.Pack(summary, raw)
	if err != nil {
		return nil, summaryDoc{}, err
	}
	file, err := backup.Seal(password, body, b.sealOpts)
	if errors.Is(err, backup.ErrTooLarge) {
		return nil, summaryDoc{}, backupError(connect.CodeResourceExhausted, reasonTooLarge,
			"копия получилась больше %d МиБ", backup.MaxFileBytes>>20)
	}
	if err != nil {
		return nil, summaryDoc{}, err
	}
	return file, doc, nil
}

// openedBackup — расшифрованная и проверенная копия.
type openedBackup struct {
	doc  summaryDoc // содержимое снимка + версия приложения и время из сводки
	path string     // файл снимка во временном каталоге
}

// openBackup расшифровывает data паролем, разбирает контейнер и проверяет
// снимок (целостность, версия схемы). Данные хранилища не меняются.
func (b *backupService) openBackup(ctx context.Context, data []byte, password string) (*openedBackup, func(), error) {
	body, err := backup.Open(password, data)
	if err != nil {
		return nil, nil, openBackupError(err)
	}
	summary, snapshot, err := backup.Unpack(body)
	if err != nil {
		return nil, nil, contentBackupError(err)
	}
	doc, err := parseSummaryDoc(summary)
	if err != nil {
		return nil, nil, contentBackupError(err)
	}
	dir, cleanup, err := b.tempDir()
	if err != nil {
		return nil, nil, err
	}
	path := filepath.Join(dir, snapshotFile)
	if err := os.WriteFile(path, snapshot, 0o600); err != nil {
		cleanup()
		return nil, nil, fmt.Errorf("запись снимка: %w", err)
	}
	info, err := b.srv.st.InspectCopy(ctx, path)
	if err != nil {
		cleanup()
		return nil, nil, contentBackupError(err)
	}
	return &openedBackup{doc: doc.withContent(info), path: path}, cleanup, nil
}
