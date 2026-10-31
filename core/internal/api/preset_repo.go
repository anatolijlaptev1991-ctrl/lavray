// SPDX-License-Identifier: GPL-3.0-only

package api

// preset_repo.go — хранилище пользовательских наборов: один JSON-массив в
// meta['routing.custom_presets']. Чтение-изменение-запись идёт под мьютексом
// (presetRepo.Modify), поэтому два параллельных UpdatePreset не затирают друг
// друга; проверку ревизии делает вызывающий внутри fn.

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/presets"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
)

// metaCustomPresets — ключ meta со списком пользовательских наборов (JSON []presets.Preset).
const metaCustomPresets = "routing.custom_presets"

// presetRepo — пользовательские наборы поверх store.Store.
type presetRepo struct {
	mu sync.Mutex
	st *store.Store
}

func newPresetRepo(st *store.Store) *presetRepo { return &presetRepo{st: st} }

// read читает список (вызывать под mu). Повреждённая запись — DATA_LOSS:
// молча принять её за «наборов нет» значило бы затереть её следующей записью.
func (r *presetRepo) read() ([]*presets.Preset, error) {
	raw, ok, err := r.st.GetMeta(metaCustomPresets)
	if err != nil {
		return nil, err
	}
	if !ok || strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var out []*presets.Preset
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, presetsDataLoss("повреждена запись пользовательских наборов (meta %s): %v", metaCustomPresets, err)
	}
	for i, p := range out {
		if p == nil {
			return nil, presetsDataLoss("повреждена запись пользовательских наборов (meta %s): элемент %d пуст", metaCustomPresets, i)
		}
	}
	return out, nil
}

// List — снимок пользовательских наборов (свежая копия: правки её не затрагивают).
func (r *presetRepo) List() ([]*presets.Preset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.read()
}

// Modify атомарно читает список, отдаёт его fn и записывает результат.
// Ошибка fn (в том числе ABORTED/NOT_FOUND) ничего не пишет. Результат больше
// MaxAllCustomBytes отвергается (RESOURCE_EXHAUSTED).
func (r *presetRepo) Modify(fn func(list []*presets.Preset) ([]*presets.Preset, error)) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	cur, err := r.read()
	if err != nil {
		return err
	}
	next, err := fn(cur)
	if err != nil {
		return err
	}
	if next == nil {
		next = []*presets.Preset{}
	}
	b, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if len(b) > presets.MaxAllCustomBytes {
		return fmt.Errorf("%w: наборы занимают %d байт, предел %d", presets.ErrLimit, len(b), presets.MaxAllCustomBytes)
	}
	return r.st.SetMeta(metaCustomPresets, string(b))
}

// indexOfPreset — позиция набора с id в списке или -1.
func indexOfPreset(list []*presets.Preset, id string) int {
	for i, p := range list {
		if p.ID == id {
			return i
		}
	}
	return -1
}

// builtinPreset — встроенный набор по id (false — такого нет).
func builtinPreset(id string) (*presets.Preset, bool, error) {
	list, err := presets.BuiltinPresets()
	if err != nil {
		return nil, false, err
	}
	for _, p := range list {
		if p.ID == id {
			return p, true, nil
		}
	}
	return nil, false, nil
}

// findPreset — встроенный или пользовательский набор по id.
func (s *Server) findPreset(id string) (*presets.Preset, bool, error) {
	if id == "" {
		return nil, false, nil
	}
	if p, ok, err := builtinPreset(id); err != nil || ok {
		return p, ok, err
	}
	custom, err := s.presetRepo.List()
	if err != nil {
		return nil, false, err
	}
	if i := indexOfPreset(custom, id); i >= 0 {
		return custom[i], true, nil
	}
	return nil, false, nil
}
