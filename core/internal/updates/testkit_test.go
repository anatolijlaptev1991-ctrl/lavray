// SPDX-License-Identifier: GPL-3.0-only

package updates

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"sort"
	"testing"
	"time"
)

// rootDef — описание корня для тестов цепочки: ключи роли root (keyid → ключ),
// ключи timestamp/manifest/sources и (необязательно) artifact-minisign.
type rootDef struct {
	version   int64
	expires   time.Time
	rootKeys  map[string]signer
	threshold int
	ts, man   signer
	art       *testMinisignKey
}

func newRootDef(t *testing.T, version int64, expires time.Time, rootKeyIDs ...string) rootDef {
	t.Helper()
	keys := map[string]signer{}
	for _, id := range rootKeyIDs {
		keys[id] = newSigner(t)
	}
	art := newMinisignKey(t)
	return rootDef{version: version, expires: expires, rootKeys: keys, threshold: 1,
		ts: newSigner(t), man: newSigner(t), art: &art}
}

func (d rootDef) signed(t *testing.T) json.RawMessage {
	t.Helper()
	keys := map[string]any{
		"t1": map[string]any{"alg": "ed25519", "pub": b64pub(t, d.ts)},
		"r1": map[string]any{"alg": "ed25519", "pub": b64pub(t, d.man)},
	}
	ids := make([]string, 0, len(d.rootKeys))
	for id, s := range d.rootKeys {
		keys[id] = map[string]any{"alg": "ed25519", "pub": b64pub(t, s)}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	roles := map[string]any{
		"root":      map[string]any{"keyids": ids, "threshold": d.threshold},
		"timestamp": map[string]any{"keyids": []string{"t1"}, "threshold": 1},
		"manifest":  map[string]any{"keyids": []string{"r1"}, "threshold": 1},
		"sources":   map[string]any{"keyids": []string{"r1"}, "threshold": 1},
	}
	if d.art != nil {
		keys["a1"] = map[string]any{"alg": "minisign", "pub": base64.StdEncoding.EncodeToString(d.art.key.Blob())}
		roles["artifact"] = map[string]any{"keyids": []string{"a1"}, "threshold": 1}
	}
	doc := map[string]any{"type": "root", "version": d.version,
		"expires": d.expires.UTC().Format(time.RFC3339), "keys": keys, "roles": roles}
	b, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// envelope подписывает документ перечисленными ключами (keyid → ключ).
func envelope(t *testing.T, signed json.RawMessage, by map[string]signer) []byte {
	t.Helper()
	sigs := []any{}
	for id, s := range by {
		sigs = append(sigs, map[string]any{"keyid": id,
			"sig": base64.StdEncoding.EncodeToString(ed25519.Sign(s.priv, signed))})
	}
	b, err := json.Marshal(map[string]any{"signed": signed, "signatures": sigs})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// selfSigned — корень, подписанный своими ключами (вшитый в сборку).
func (d rootDef) selfSigned(t *testing.T) []byte { return envelope(t, d.signed(t), d.rootKeys) }

// rotatedFrom — корень d, подписанный ключами предыдущего корня и своими.
func (d rootDef) rotatedFrom(t *testing.T, prev rootDef) []byte {
	t.Helper()
	by := map[string]signer{}
	for id, s := range prev.rootKeys {
		by[id] = s
	}
	for id, s := range d.rootKeys {
		by[id] = s
	}
	return envelope(t, d.signed(t), by)
}

func mustTrust(t *testing.T, raw []byte) *Trust {
	t.Helper()
	tr, err := NewTrust(raw)
	if err != nil {
		t.Fatal(err)
	}
	return tr
}

func newMem() *memSource { return &memSource{files: map[string][]byte{}} }

// fakeRootStore — RootStore в памяти (считает записи).
type fakeRootStore struct {
	raw   []byte
	saves int
}

func (f *fakeRootStore) LoadRoot() ([]byte, error) { return f.raw, nil }
func (f *fakeRootStore) SaveRoot(raw []byte) error {
	f.raw = append([]byte(nil), raw...)
	f.saves++
	return nil
}
