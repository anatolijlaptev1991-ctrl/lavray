// SPDX-License-Identifier: GPL-3.0-only

package api

// preset_list_dup_test.go — в списке наборов каждый id встречается один раз,
// даже если в хранилище пользовательских наборов лежит запись с id встроенного
// (копия встроенного файла, записанная в обход API с его же id и builtin=true).

import (
	"strings"
	"testing"

	"connectrpc.com/connect"

	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/presets"
)

// TestListPresetsSkipsCustomWithBuiltinID: запись с id «lav-ru» в
// routing.custom_presets не даёт второй карточки; обычные свои наборы на месте,
// запись в хранилище не затёрта, встроенный набор читается и активируется.
func TestListPresetsSkipsCustomWithBuiltinID(t *testing.T) {
	cs := newE2E(t)
	cp := copyOf(t, cs, "lav-ru")

	// Копия встроенного файла, как её пишет внешний скрипт: id и builtin те же.
	list, err := presets.BuiltinPresets()
	if err != nil {
		t.Fatal(err)
	}
	var lavru *presets.Preset
	for _, p := range list {
		if p.ID == "lav-ru" {
			lavru = p
		}
	}
	if lavru == nil {
		t.Fatal("lav-ru не найден")
	}
	stored, _, err := cs.st.GetMeta(metaCustomPresets)
	if err != nil {
		t.Fatal(err)
	}
	if err := cs.st.SetMeta(metaCustomPresets, strings.TrimSuffix(stored, "]")+","+encodeForTest(t, lavru)+"]"); err != nil {
		t.Fatal(err)
	}
	rawBefore, ok, _ := cs.st.GetMeta(metaCustomPresets)
	if !ok || !strings.Contains(rawBefore, `"id":"lav-ru"`) {
		t.Fatalf("запись-дубликат не записана: %q", rawBefore)
	}

	ids, byID := listIDs(t, cs)
	seen := map[string]int{}
	for _, id := range ids {
		seen[id]++
	}
	if seen["lav-ru"] != 1 || len(ids) != len(presets.BuiltinFiles)+1 {
		t.Fatalf("ListPresets: id идут по одному разу, получено %v", ids)
	}
	if seen[cp.Id] != 1 || byID[cp.Id].Builtin {
		t.Errorf("свой набор пропал или стал встроенным: %v", ids)
	}
	if p := byID["lav-ru"]; !p.Builtin || p.Revision != int32(lavru.Revision) || len(p.ProcessRules) != len(lavru.Routing.ProcessRules) {
		t.Errorf("в списке не встроенный набор: builtin=%v rev=%d правил=%d", p.Builtin, p.Revision, len(p.ProcessRules))
	}

	// Запись в хранилище не затёрта: список её только не показывает.
	if rawAfter, _, _ := cs.st.GetMeta(metaCustomPresets); rawAfter != rawBefore {
		t.Fatalf("запись пользовательских наборов изменена при чтении списка")
	}

	// Активация и чтение по id — это встроенный набор, а не запись из хранилища.
	if _, err := cs.routing.ActivatePreset(bg, connect.NewRequest(&lavrayv1.ActivatePresetRequest{Id: "lav-ru"})); err != nil {
		t.Fatal(err)
	}
	res, err := cs.routing.ListPresets(bg, connect.NewRequest(&lavrayv1.ListPresetsRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	highlighted := 0
	for _, p := range res.Msg.Presets {
		if p.Id == res.Msg.ActivePresetId {
			highlighted++
		}
	}
	if res.Msg.ActivePresetId != "lav-ru" || highlighted != 1 {
		t.Fatalf("active=%q, карточек с id активного: %d", res.Msg.ActivePresetId, highlighted)
	}
	got := getPreset(t, cs, "lav-ru")
	if !got.Builtin {
		t.Fatalf("GetPreset(lav-ru): builtin=%v", got.Builtin)
	}
}

// encodeForTest — запись набора в том виде, в каком её хранит репозиторий.
func encodeForTest(t *testing.T, p *presets.Preset) string {
	t.Helper()
	raw, err := encodePresets([]*presets.Preset{p})
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSuffix(strings.TrimPrefix(raw, "["), "]")
}
