// SPDX-License-Identifier: GPL-3.0-only

package api

// backup_service.go — BackupService (T-83): зашифрованная копия всех данных
// (формат LAVBK1, пакет backup) и полная замена данных из неё. Пароль живёт
// только в памяти запроса: ни журнал, ни настройки, ни ошибки его не содержат.

import (
	"context"
	"slices"
	"sync/atomic"
	"time"

	"connectrpc.com/connect"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/backup"
	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/logs"
)

// backupWireLimit — предел одного сообщения BackupService на проводе. Копия до
// 64 МиБ (backup.MaxFileBytes) передаётся в JSON как base64, то есть раздувается
// в 4/3 раза, плюс поля пароля и обрамление. Точный предел на сам файл
// проверяет checkBackupSize. Общий лимит ядра (MaxRequestBytes, 16 МиБ)
// остаётся для остальных сервисов.
const backupWireLimit = (backup.MaxFileBytes+2)/3*4 + 64<<10

// backupService — реализация lavrayv1connect.BackupServiceHandler.
type backupService struct {
	srv *Server
	// busy — семафор на одну операцию: параллельные копии не нужны, а Argon2id
	// и снимок БД дорогие.
	busy atomic.Bool
	// sealOpts — параметры Seal; нулевые = боевые (тесты ставят быстрые).
	sealOpts backup.Options
	now      func() time.Time
	// onAcquired вызывается сразу после захвата семафора (точка синхронизации
	// для тестов).
	onAcquired func()
}

func newBackupService(s *Server) *backupService {
	return &backupService{srv: s, now: time.Now}
}

// handlerOptions — общие опции хендлеров плюс свой, более высокий предел
// размера сообщения (в обе стороны).
func (b *backupService) handlerOptions(base []connect.HandlerOption) []connect.HandlerOption {
	return append(slices.Clone(base),
		connect.WithReadMaxBytes(backupWireLimit),
		connect.WithSendMaxBytes(backupWireLimit))
}

// acquire захватывает семафор; занято — ABORTED.
func (b *backupService) acquire() (release func(), err error) {
	if !b.busy.CompareAndSwap(false, true) {
		return nil, backupError(connect.CodeAborted, reasonBusy, "уже идёт другая операция с резервной копией")
	}
	release = func() { b.busy.Store(false) }
	if b.onAcquired != nil {
		b.onAcquired()
	}
	return release, nil
}

// ExportBackup собирает снимок, упаковывает и шифрует его паролем.
func (b *backupService) ExportBackup(ctx context.Context, req *connect.Request[lavrayv1.ExportBackupRequest]) (*connect.Response[lavrayv1.ExportBackupResponse], error) {
	if err := checkBackupPassword(req.Msg.Password); err != nil {
		return nil, err
	}
	release, err := b.acquire()
	if err != nil {
		return nil, err
	}
	defer release()
	data, doc, err := b.buildBackup(ctx, req.Msg.Password)
	if err != nil {
		return nil, err
	}
	b.srv.logs.Logf(logs.LevelInfo, logs.SourceAPI,
		"резервная копия создана: групп %d, профилей %d, подписок %d, %d байт", doc.Groups, doc.Profiles, doc.Subscriptions, len(data))
	return connect.NewResponse(&lavrayv1.ExportBackupResponse{
		Data:          data,
		SuggestedName: "lavray-backup-" + b.now().Format("20060102-150405") + ".lavbk",
		Summary:       doc.summaryProto(),
	}), nil
}

// PreviewBackup расшифровывает копию и показывает, что в ней; данные не меняются.
func (b *backupService) PreviewBackup(ctx context.Context, req *connect.Request[lavrayv1.PreviewBackupRequest]) (*connect.Response[lavrayv1.BackupSummary], error) {
	if err := checkBackupPassword(req.Msg.Password); err != nil {
		return nil, err
	}
	if err := checkBackupSize(req.Msg.Data); err != nil {
		return nil, err
	}
	release, err := b.acquire()
	if err != nil {
		return nil, err
	}
	defer release()
	opened, cleanup, err := b.openBackup(ctx, req.Msg.Data, req.Msg.Password)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	return connect.NewResponse(opened.doc.summaryProto()), nil
}

// ImportBackup заменяет все данные содержимым копии. Порядок: дешёвые проверки
// запроса, семафор, состояние ядра, расшифрование и проверка копии (самое
// долгое, данные не трогаются), и только затем остановка планировщика
// подписок и атомарная замена.
func (b *backupService) ImportBackup(ctx context.Context, req *connect.Request[lavrayv1.ImportBackupRequest]) (*connect.Response[lavrayv1.ImportBackupResponse], error) {
	m := req.Msg
	if err := checkBackupPassword(m.Password); err != nil {
		return nil, err
	}
	if err := checkBackupSize(m.Data); err != nil {
		return nil, err
	}
	if !m.ConfirmReplace {
		return nil, backupError(connect.CodeFailedPrecondition, reasonConfirmRequired,
			"восстановление заменяет все текущие данные: нужно подтверждение (confirm_replace)")
	}
	release, err := b.acquire()
	if err != nil {
		return nil, err
	}
	defer release()
	if err := b.checkReplaceAllowed(); err != nil {
		return nil, err
	}
	opened, cleanup, err := b.openBackup(ctx, m.Data, m.Password)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	res, err := b.replaceAll(ctx, opened)
	if err != nil {
		return nil, err
	}
	b.srv.logs.Logf(logs.LevelInfo, logs.SourceAPI,
		"резервная копия восстановлена: групп %d, профилей %d, подписок %d", res.Restored.Groups, res.Restored.Profiles, res.Restored.Subscriptions)
	return connect.NewResponse(res), nil
}
