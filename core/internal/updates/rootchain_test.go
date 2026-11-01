// SPDX-License-Identifier: GPL-3.0-only

package updates

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"
)

var (
	farFuture = time.Now().Add(2 * 365 * 24 * time.Hour)
	longPast  = time.Now().Add(-48 * time.Hour)
)

func TestRotationChainNToN3(t *testing.T) {
	r1 := newRootDef(t, 1, farFuture, "k1")
	r2 := newRootDef(t, 2, farFuture, "k2")
	r3 := newRootDef(t, 3, farFuture, "k3")
	src := newMem()
	src.put("2.root.json", r2.rotatedFrom(t, r1))
	src.put("3.root.json", r3.rotatedFrom(t, r2))
	got, steps, err := AdvanceRoot(context.Background(), []Source{src}, mustTrust(t, r1.selfSigned(t)), time.Now())
	if err != nil || steps != 2 || got.Root().Version != 3 {
		t.Fatalf("v=%v steps=%d err=%v", got, steps, err)
	}
}

func TestExpiredEmbeddedRootRotatesToValid(t *testing.T) {
	r1 := newRootDef(t, 1, longPast, "k1")
	r2 := newRootDef(t, 2, farFuture, "k2")
	src := newMem()
	src.put("2.root.json", r2.rotatedFrom(t, r1))
	got, steps, err := AdvanceRoot(context.Background(), []Source{src}, mustTrust(t, r1.selfSigned(t)), time.Now())
	if err != nil || steps != 1 || got.Root().Version != 2 {
		t.Fatalf("просроченный вшитый корень должен ротироваться: %v %d %v", got, steps, err)
	}
}

func TestFinalRootExpiredFails(t *testing.T) {
	r1 := newRootDef(t, 1, longPast, "k1")
	if _, _, err := AdvanceRoot(context.Background(), []Source{newMem()}, mustTrust(t, r1.selfSigned(t)), time.Now()); !errors.Is(err, ErrExpired) {
		t.Fatalf("итоговый просроченный корень: %v", err)
	}
	r2 := newRootDef(t, 2, longPast.Add(time.Hour), "k2")
	src := newMem()
	src.put("2.root.json", r2.rotatedFrom(t, r1))
	if _, _, err := AdvanceRoot(context.Background(), []Source{src}, mustTrust(t, r1.selfSigned(t)), time.Now()); !errors.Is(err, ErrExpired) {
		t.Fatalf("просрочен и итоговый v2: %v", err)
	}
}

func TestRotationStopsAt404(t *testing.T) {
	r1 := newRootDef(t, 1, farFuture, "k1")
	got, steps, err := AdvanceRoot(context.Background(), []Source{newMem(), newMem()}, mustTrust(t, r1.selfSigned(t)), time.Now())
	if err != nil || steps != 0 || got.Root().Version != 1 {
		t.Fatalf("нет N+1: %v %d %v", got, steps, err)
	}
}

func TestRotationSkipRejected(t *testing.T) {
	r1 := newRootDef(t, 1, farFuture, "k1")
	r3 := newRootDef(t, 3, farFuture, "k3")
	src := newMem()
	src.put("2.root.json", r3.rotatedFrom(t, r1)) // под именем v2 лежит v3
	if _, _, err := AdvanceRoot(context.Background(), []Source{src}, mustTrust(t, r1.selfSigned(t)), time.Now()); !errors.Is(err, ErrRootRotation) {
		t.Fatalf("пропуск версии: %v", err)
	}
}

func TestRotationRequiresNewKeys(t *testing.T) {
	r1 := newRootDef(t, 1, farFuture, "k1")
	r2 := newRootDef(t, 2, farFuture, "k2")
	src := newMem()
	// подписан только СТАРЫМ ключом: компрометация k1 не должна переписать доверие
	src.put("2.root.json", envelope(t, r2.signed(t), r1.rootKeys))
	if _, _, err := AdvanceRoot(context.Background(), []Source{src}, mustTrust(t, r1.selfSigned(t)), time.Now()); !errors.Is(err, ErrRootRotation) {
		t.Fatalf("корень без подписи новых ключей: %v", err)
	}
	// подписан только НОВЫМ ключом: порог старого корня не достигнут
	src.put("2.root.json", envelope(t, r2.signed(t), r2.rootKeys))
	if _, _, err := AdvanceRoot(context.Background(), []Source{src}, mustTrust(t, r1.selfSigned(t)), time.Now()); !errors.Is(err, ErrRootRotation) {
		t.Fatalf("корень без подписи порога старых ключей: %v", err)
	}
}

func TestRevokedKeyRejectedAfterTwoRotations(t *testing.T) {
	r1 := newRootDef(t, 1, farFuture, "k1")
	r2 := newRootDef(t, 2, farFuture, "k2") // k1 отозван, ключи timestamp/manifest новые
	r3 := newRootDef(t, 3, farFuture, "k3")
	src := newMem()
	src.put("2.root.json", r2.rotatedFrom(t, r1))
	src.put("3.root.json", r3.rotatedFrom(t, r2))
	tr, _, err := AdvanceRoot(context.Background(), []Source{src}, mustTrust(t, r1.selfSigned(t)), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	oldTS := map[string]signer{"t1": r1.ts}
	stale := envelope(t, []byte(`{"type":"timestamp"}`), oldTS)
	if _, err := tr.Verify(stale, RoleTimestamp); err == nil {
		t.Fatal("timestamp, подписанный ключом из корня v1, принят после двух ротаций")
	}
	if _, err := tr.Verify(envelope(t, []byte(`{"type":"timestamp"}`), map[string]signer{"t1": r3.ts}), RoleTimestamp); err != nil {
		t.Fatalf("ключ из итогового корня должен работать: %v", err)
	}
	// попытка «воскресить» отозванный k1: v4, подписанный только k1 и новым ключом
	r4 := newRootDef(t, 4, farFuture, "k4")
	src.put("4.root.json", r4.rotatedFrom(t, r1))
	if _, _, err := AdvanceRoot(context.Background(), []Source{src}, tr, time.Now()); !errors.Is(err, ErrRootRotation) {
		t.Fatalf("корень, подписанный отозванным ключом: %v", err)
	}
}

func TestRotationLoopCapped(t *testing.T) {
	prev := newRootDef(t, 1, farFuture, "k1")
	start := mustTrust(t, prev.selfSigned(t))
	src := newMem()
	for v := int64(2); v <= MaxRootSteps+6; v++ {
		next := newRootDef(t, v, farFuture, fmt.Sprintf("k%d", v))
		src.put(RootName(v), next.rotatedFrom(t, prev))
		prev = next
	}
	got, steps, err := AdvanceRoot(context.Background(), []Source{src}, start, time.Now())
	if err != nil || steps != MaxRootSteps || got.Root().Version != 1+MaxRootSteps {
		t.Fatalf("цепочка должна обрываться на %d шагах: v=%d steps=%d err=%v", MaxRootSteps, got.Root().Version, steps, err)
	}
}

func TestRootPersistedNotDowngraded(t *testing.T) {
	r1 := newRootDef(t, 1, farFuture, "k1")
	r2 := newRootDef(t, 2, farFuture, "k2")
	r3 := newRootDef(t, 3, farFuture, "k3")
	store := &fakeRootStore{}
	t3 := mustTrust(t, r3.rotatedFrom(t, r2))
	if err := PersistRoot(store, t3); err != nil || store.saves != 1 {
		t.Fatalf("первое сохранение: %v saves=%d", err, store.saves)
	}
	if err := PersistRoot(store, t3); err != nil || store.saves != 1 {
		t.Fatalf("повторное сохранение должно быть идемпотентным: saves=%d", store.saves)
	}
	if err := PersistRoot(store, mustTrust(t, r2.selfSigned(t))); err != nil || store.saves != 1 {
		t.Fatalf("понижение версии не должно писаться: saves=%d", store.saves)
	}
	got, err := ResolveTrust(r1.selfSigned(t), store)
	if err != nil || got.Root().Version != 3 {
		t.Fatalf("вшитый v1 не должен перебивать сохранённый v3: %v %v", got, err)
	}
	// новая сборка с вшитым v4 перебивает сохранённый v3
	r4 := newRootDef(t, 4, farFuture, "k4")
	got, err = ResolveTrust(r4.selfSigned(t), store)
	if err != nil || got.Root().Version != 4 {
		t.Fatalf("более новый вшитый корень: %v %v", got, err)
	}
	store.raw = []byte("мусор")
	if got, err = ResolveTrust(r1.selfSigned(t), store); err != nil || got.Root().Version != 1 {
		t.Fatalf("испорченный сохранённый корень игнорируется: %v %v", got, err)
	}
	if _, err = ResolveTrust(nil, store); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("нет вшитого корня: %v", err)
	}
}

func TestRootWithoutArtifactRole(t *testing.T) {
	r1 := newRootDef(t, 1, farFuture, "k1")
	r1.art = nil
	tr := mustTrust(t, r1.selfSigned(t))
	if _, err := tr.Root().ArtifactKeys(); !errors.Is(err, ErrArtifactRoleMissing) {
		t.Fatalf("корень без роли artifact: %v", err)
	}
}

func TestRootRejectsMixedKeyAlgs(t *testing.T) {
	r1 := newRootDef(t, 1, farFuture, "k1")
	for name, role := range map[string]string{"timestamp": "a1", "artifact": "t1"} {
		var doc map[string]any
		if err := json.Unmarshal(r1.signed(t), &doc); err != nil {
			t.Fatal(err)
		}
		roles := doc["roles"].(map[string]any)
		roles[name] = map[string]any{"keyids": []string{role}, "threshold": 1}
		raw, _ := json.Marshal(doc)
		if _, err := ParseRoot(raw); !errors.Is(err, ErrBadValue) {
			t.Errorf("роль %s с ключом %s другого алгоритма принята: %v", name, role, err)
		}
	}
}
