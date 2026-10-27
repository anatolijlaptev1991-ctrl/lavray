package subs

import (
	"testing"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
)

// TestApplyFillsGeo — регрессия A17 аудита round 1: подписка с ключами по
// странам должна заполнять geo при применении, иначе UI-группировка
// «по странам» остаётся пустой для всех подписочных серверов.
func TestApplyFillsGeo(t *testing.T) {
	st := newTestStore(t)
	g := &model.Group{Name: "sub", Kind: model.GroupSubscription, SubscriptionURL: "https://example.com/sub"}
	if err := st.CreateGroup(g); err != nil {
		t.Fatal(err)
	}
	snap, err := TakeSnapshot(st, g.ID)
	if err != nil {
		t.Fatal(err)
	}
	next := []*model.Profile{
		{Type: model.TypeTrojan, Name: "🇯🇵 Токио", Address: "jp.example.com", Port: 443,
			Detail: &model.TrojanVlessDetail{Password: "p"}},
		{Type: model.TypeTrojan, Name: "Амстердам", Address: "nl.example.com", Port: 443,
			Detail: &model.TrojanVlessDetail{Password: "p"}},
		{Type: model.TypeTrojan, Name: "node-1", Address: "unknown.example.com", Port: 443,
			Detail: &model.TrojanVlessDetail{Password: "p"}},
	}
	if _, err := Apply(st, snap, ApplyParams{Next: next, Confirmed: true}); err != nil {
		t.Fatalf("apply: %v", err)
	}
	list, err := st.ListProfiles(g.ID)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, p := range list {
		got[p.Name] = p.Geo
	}
	want := map[string]string{"🇯🇵 Токио": "jp", "Амстердам": "nl", "node-1": ""}
	for name, geo := range want {
		if got[name] != geo {
			t.Errorf("%s: geo=%q want %q", name, got[name], geo)
		}
	}
}
