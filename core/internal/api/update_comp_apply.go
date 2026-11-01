// SPDX-License-Identifier: GPL-3.0-only

// update_comp_apply.go — ApplyUpdates и Rollback для PRESETS и GEO (T-75/7.5).
// Применение требует скачанного и проверенного артефакта, как у приложения:
// файл в staging перечитывается и сверяется заново (анти-TOCTOU), затем
// updates.ApplyPresets/ApplyGeo проверяют содержимое и атомарно подменяют
// данные. Профиль, собранный из прежних данных, продолжает работать; если
// изменился активный набор или гео, а сессия идёт, сообщается ready_for_restart
// с причиной "profile". Параллельное применение и откат — ABORTED.
package api

import (
	"errors"
	"fmt"
	"os"
	"slices"

	"connectrpc.com/connect"

	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/presets"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// restartProfile — причина ready_for_restart: перезапустить профиль, не приложение.
const restartProfile = "profile"

type eventSend = func(*lavrayv1.UpdateEvent) bool

// applyData применяет скачанный компонент-данные. Нарушение целостности — событие
// verify_failed и очистка staging; состояние окружения — ошибка вызова.
func (s *Server) applyData(c lavrayv1.UpdateComponent, stream *connect.ServerStream[lavrayv1.UpdateEvent]) error {
	staged := s.upd.stagedOf(c)
	if staged == nil {
		return reasonError(ReasonNotStaged, "сначала скачайте обновление (%s)", compName(c))
	}
	if !s.upd.beginApply() {
		return connect.NewError(connect.CodeAborted, errors.New("применение или откат данных уже идёт"))
	}
	defer s.upd.endApply()
	if h := s.upd.hookApply; h != nil {
		h()
	}
	send := eventSender(stream)
	s.upd.setCompPhase(c, lavrayv1.ComponentState_PHASE_APPLYING, "")
	restart, err := s.applyStaged(c, staged)
	if err != nil {
		return s.dataApplyFailed(c, staged, err, send)
	}
	s.upd.setCompStaged(c, nil)
	s.cleanComponentStaging(staged)
	send(&lavrayv1.UpdateEvent{Kind: &lavrayv1.UpdateEvent_Applied{Applied: compName(c)}})
	if restart && s.sessionActive() {
		send(&lavrayv1.UpdateEvent{Kind: &lavrayv1.UpdateEvent_ReadyForRestart{ReadyForRestart: restartProfile}})
	}
	return nil
}

func compName(c lavrayv1.UpdateComponent) string {
	if c == compPresets {
		return "presets"
	}
	return "geo"
}

// applyStaged применяет артефакт; restart — изменились данные работающего профиля.
func (s *Server) applyStaged(c lavrayv1.UpdateComponent, staged *stagedComp) (bool, error) {
	if c == compPresets {
		return s.applyPresetFiles(staged)
	}
	return s.applyGeoFile(staged)
}

func (s *Server) applyPresetFiles(staged *stagedComp) (bool, error) {
	files := make([]updates.PresetFile, 0, len(staged.files))
	for _, f := range staged.files {
		data, err := s.readStaged(f, updates.MaxPresetBytes)
		if err != nil {
			return false, err
		}
		files = append(files, updates.PresetFile{ID: f.id, Data: data})
	}
	changes, err := updates.ApplyPresets(s.presetOverrideDir(), staged.manifest, files)
	if err != nil {
		return false, err
	}
	active := s.activePresetID()
	return slices.ContainsFunc(changes, func(c updates.PresetChange) bool { return c.ID == active }), nil
}

func (s *Server) applyGeoFile(staged *stagedComp) (bool, error) {
	sec := staged.manifest.Geo
	if sec == nil || len(staged.files) != 1 {
		return false, fmt.Errorf("%w: гео-набор не скачан", updates.ErrNotStaged)
	}
	data, err := s.readStaged(staged.files[0], updates.MaxGeoArchiveBytes)
	if err != nil {
		return false, err
	}
	required, err := presets.EmbeddedGeoFiles()
	if err != nil {
		return false, err
	}
	res, err := updates.ApplyGeo(s.geoDir(), data, *sec, updates.DefaultGeoLimits, required)
	if err != nil {
		return false, err
	}
	return res.Changed, nil
}

// readStaged читает файл из staging/components, не выходя за каталог и за предел размера.
func (s *Server) readStaged(f stagedFile, limit int64) ([]byte, error) {
	p, err := updates.InsideStaging(s.compStagingDir(), f.path)
	if err != nil {
		return nil, err
	}
	fi, err := os.Stat(p)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", updates.ErrNotStaged, err)
	}
	if fi.Size() > limit {
		return nil, fmt.Errorf("%w: файл в staging больше %d байт", updates.ErrTooLarge, limit)
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", updates.ErrNotStaged, err)
	}
	return data, nil
}

// dataApplyFailed разбирает причину неудачного применения.
func (s *Server) dataApplyFailed(c lavrayv1.UpdateComponent, staged *stagedComp, err error, send eventSend) error {
	if errors.Is(err, updates.ErrDirBusy) {
		s.upd.setCompPhase(c, lavrayv1.ComponentState_PHASE_DOWNLOADED, err.Error())
		return componentStateErr(err) // артефакт цел: повторить можно после отключения
	}
	s.upd.setCompStaged(c, nil)
	s.cleanComponentStaging(staged)
	s.upd.setCompPhase(c, lavrayv1.ComponentState_PHASE_FAILED, err.Error())
	reason := componentFailReason(err)
	if errors.Is(err, updates.ErrNotStaged) {
		reason = "not_staged"
	}
	if reason == "" {
		return mapErr(err)
	}
	send(&lavrayv1.UpdateEvent{Kind: &lavrayv1.UpdateEvent_VerifyFailed{VerifyFailed: &lavrayv1.VerificationFailed{Component: c, Reason: reason}}})
	return nil
}
