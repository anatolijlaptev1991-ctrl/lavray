package store

import (
	"errors"
	"testing"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
)

// D-04: счётчики трафика пишутся отдельным UPDATE (UpdateProfile их не пишет),
// остальные поля профиля при этом не затрагиваются.
func TestSaveTraffic(t *testing.T) {
	s := openTemp(t)
	g := newGroup("G", model.GroupBasic)
	if err := s.CreateGroup(g); err != nil {
		t.Fatal(err)
	}
	p := newProfile(g.ID, model.TypeTrojan, "srv", "1.1.1.1", 443)
	p.Traffic = model.TrafficCounters{UplinkBytes: 500, DownlinkBytes: 900}
	if err := s.CreateProfile(p); err != nil {
		t.Fatal(err)
	}

	// UpdateProfile не трогает счётчики (контракт метода).
	edited, _ := s.GetProfile(p.ID)
	edited.Traffic = model.TrafficCounters{}
	edited.Name = "renamed"
	if err := s.UpdateProfile(edited); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.GetProfile(p.ID); got.Traffic != (model.TrafficCounters{UplinkBytes: 500, DownlinkBytes: 900}) {
		t.Fatalf("UpdateProfile изменил счётчики: %+v", got.Traffic)
	}
	before, _ := s.GetProfile(p.ID)

	if err := s.SaveTraffic(p.ID, model.TrafficCounters{}); err != nil {
		t.Fatalf("SaveTraffic: %v", err)
	}
	after, err := s.GetProfile(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Traffic != (model.TrafficCounters{}) {
		t.Fatalf("после сброса %+v, ожидалось {0 0}", after.Traffic)
	}
	if after.Name != "renamed" || after.UpdatedAtMs != before.UpdatedAtMs {
		t.Fatalf("SaveTraffic тронул другие поля: имя %q, updated_at %d -> %d", after.Name, before.UpdatedAtMs, after.UpdatedAtMs)
	}

	if err := s.SaveTraffic(p.ID, model.TrafficCounters{UplinkBytes: 7, DownlinkBytes: 8}); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.GetProfile(p.ID); got.Traffic != (model.TrafficCounters{UplinkBytes: 7, DownlinkBytes: 8}) {
		t.Fatalf("запись значений: %+v", got.Traffic)
	}

	if err := s.SaveTraffic(999999, model.TrafficCounters{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("несуществующий профиль: %v, ожидалось ErrNotFound", err)
	}
}
