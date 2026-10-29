// SPDX-License-Identifier: GPL-3.0-only

// headless_glue.go — обвязка headless-режима (F19): CoreAPI для
// internal/headless поверх api.Server. Автозапуск запомненного профиля и
// авторестарт после падения — для lavrayd на OpenWrt и службы Windows.
package api

import (
	"context"
	"errors"
	"strconv"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/inst"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
)

// ConnectLast — подключить «запомненный» профиль (remember.id/remember.enable,
// перенос §5.4 NekoBox). Используется headless-циклом при старте службы.
func (s *Server) ConnectLast(ctx context.Context) error {
	if !s.settingBool("remember.enable") {
		return errNoRememberedProfile
	}
	id := int64(s.settingInt("remember.id"))
	if id <= 0 {
		return errNoRememberedProfile
	}
	p, err := s.st.GetProfile(id)
	if err != nil {
		return err
	}
	status, _, err := s.startRun(ctx, p, s.rememberedMode())
	if err != nil {
		if errors.Is(err, inst.ErrAlreadyRunning) {
			return nil // уже подключено — для headless это успех
		}
		return err
	}
	if status != nil {
		s.logs.Logf("info", "core", "headless: подключён профиль %d (%s)", p.ID, p.Name)
	}
	return nil
}

// StatusAlive — инстанс держит соединение (эквивалент CORE_STATE_CONNECTED).
func (s *Server) StatusAlive() bool {
	st := s.inst.Status()
	return st.State == inst.StateReady
}

// ErrNoRememberedProfile — headless без запомненного профиля (штатная
// ситуация: служба стартует, но соединяться не с чем).
var errNoRememberedProfile = errors.New("headless: запомненный профиль не задан (remember.enable/remember.id)")

// ErrNoRememberedProfile — экспорт для вызывающей стороны (cmd).
var ErrNoRememberedProfile = errNoRememberedProfile

// RememberProfile — сохранить профиль как «последний» (вызывается после
// успешного Connect, если remember.enable).
func (s *Server) RememberProfile(p *model.Profile) {
	if p == nil || !s.settingBool("remember.enable") {
		return
	}
	_ = s.st.SetSetting("remember.id", strconv.FormatInt(p.ID, 10))
}
