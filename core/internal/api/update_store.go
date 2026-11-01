// SPDX-License-Identifier: GPL-3.0-only

// update_store.go — состояние обновлений в таблице settings. Все ключи
// служебные (model.SettingDescriptor.Internal): клиент не может ни прочитать, ни
// записать их через SettingsService, и они не попадают в резервную копию.
package api

import (
	"encoding/json"
	"strconv"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

const (
	setUpdRoot     = model.SettingUpdateRootVersion
	setUpdSerialSt = model.SettingUpdateSerialStable
	setUpdSerialBe = model.SettingUpdateSerialBeta
	setUpdChecked  = model.SettingUpdateLastChecked
	setUpdLastURL  = model.SettingUpdateLastURL
	setUpdTSVer    = model.SettingUpdateTimestampVersion
	setUpdRootJSON = model.SettingUpdateRootJSON
)

func (s *Server) loadUpdateState() updates.State {
	st := updates.State{}
	get := func(k string, dst *int64) {
		if v, ok, _ := s.st.GetSetting(k); ok {
			if n, err := strconv.ParseInt(v, 10, 64); err == nil {
				*dst = n
			}
		}
	}
	get(setUpdRoot, &st.RootVersion)
	get(setUpdSerialSt, &st.SerialStable)
	get(setUpdSerialBe, &st.SerialBeta)
	get(setUpdTSVer, &st.TimestampVersion)
	get(setUpdChecked, &st.LastCheckedAt)
	if v, ok, _ := s.st.GetSetting(setUpdLastURL); ok {
		var url string
		if json.Unmarshal([]byte(v), &url) == nil {
			st.LastWorkingURL = url
		}
	}
	return st
}

// saveUpdateState пишет состояние. Монотонные счётчики не уменьшаются даже при
// гонке двух проверок: записывается максимум из сохранённого и нового.
func (s *Server) saveUpdateState(st *updates.State) {
	cur := s.loadUpdateState()
	setNum := func(k string, v int64) { _ = s.st.SetSetting(k, strconv.FormatInt(v, 10)) }
	setNum(setUpdRoot, max(cur.RootVersion, st.RootVersion))
	setNum(setUpdSerialSt, max(cur.SerialStable, st.SerialStable))
	setNum(setUpdSerialBe, max(cur.SerialBeta, st.SerialBeta))
	setNum(setUpdTSVer, max(cur.TimestampVersion, st.TimestampVersion))
	setNum(setUpdChecked, st.LastCheckedAt)
	b, _ := json.Marshal(st.LastWorkingURL)
	_ = s.st.SetSetting(setUpdLastURL, string(b))
}

// settingsRootStore — updates.RootStore поверх настройки update.root_json.
type settingsRootStore struct{ st *store.Store }

func (r settingsRootStore) LoadRoot() ([]byte, error) {
	v, ok, err := r.st.GetSetting(setUpdRootJSON)
	if err != nil || !ok || v == "" {
		return nil, err
	}
	return []byte(v), nil
}

func (r settingsRootStore) SaveRoot(raw []byte) error {
	return r.st.SetSetting(setUpdRootJSON, string(raw))
}
