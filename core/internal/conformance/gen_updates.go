// SPDX-License-Identifier: GPL-3.0-only

package conformance

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// Фиксированное «сейчас» образцов TUF-lite и состояние клиента, относительно
// которого считаются откат и срок: версии/serial в документах «valid» выше.
var (
	refTime   = time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	farFuture = time.Date(2036, 1, 1, 0, 0, 0, 0, time.UTC)
	longPast  = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	// tsFresh — срок timestamp внутри окна свежести клиента (7 суток + допуск 1 сутки);
	// tsFar — за окном (updates.ErrTimestampHorizon).
	tsFresh      = refTime.Add(24 * time.Hour)
	tsFar        = refTime.Add(30 * 24 * time.Hour)
	storedTS     = int64(4) // сохранённая версия timestamp
	storedSerial = int64(9) // сохранённый serial манифеста stable
)

const (
	updProduct  = "lavray-windows"
	updPlatform = "windows-x64"
	updVersion  = "1.2.0"
	updAsset    = "lavray-setup.bin"
)

type updKeys struct {
	root, root2, ts, man, man2, art, other ed25519.PrivateKey
	artID                                  [8]byte
}

func detKey(label string) ed25519.PrivateKey {
	seed := sha256.Sum256([]byte("lavray-conformance/updates/" + label))
	return ed25519.NewKeyFromSeed(seed[:])
}

func newUpdKeys() updKeys {
	k := updKeys{root: detKey("root"), root2: detKey("root2"), ts: detKey("timestamp"),
		man: detKey("manifest"), man2: detKey("manifest2"), art: detKey("artifact"), other: detKey("other")}
	id := sha256.Sum256([]byte("lavray-conformance/updates/artifact-id"))
	copy(k.artID[:], id[:])
	return k
}

func hexSum(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func b64(b []byte) string    { return base64.StdEncoding.EncodeToString(b) }
func rfc(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func pubOf(k ed25519.PrivateKey) string { return b64(k.Public().(ed25519.PublicKey)) }

func signedBytes(doc map[string]any) []byte {
	b, _ := json.Marshal(doc)
	return b
}

// envelope — {"signed", "signatures"}; signers — пары keyid, ключ подписи.
func envelope(signed map[string]any, signers ...any) ([]byte, error) {
	raw := signedBytes(signed)
	var sigs []any
	for i := 0; i+1 < len(signers); i += 2 {
		k := signers[i+1].(ed25519.PrivateKey)
		sigs = append(sigs, map[string]any{"keyid": signers[i], "sig": b64(ed25519.Sign(k, raw))})
	}
	b, err := json.Marshal(map[string]any{"signed": json.RawMessage(raw), "signatures": sigs})
	return append(b, '\n'), err
}

func rootDoc(k updKeys, expires time.Time, rootRole, manRole map[string]any) map[string]any {
	role := func(id string) map[string]any { return map[string]any{"keyids": []string{id}, "threshold": 1} }
	art := updates.MinisignKey{KeyID: k.artID, Pub: k.art.Public().(ed25519.PublicKey)}
	return map[string]any{"type": "root", "version": 1, "expires": rfc(expires),
		"keys": map[string]any{
			"k1": map[string]any{"alg": "ed25519", "pub": pubOf(k.root)},
			"k2": map[string]any{"alg": "ed25519", "pub": pubOf(k.root2)},
			"t1": map[string]any{"alg": "ed25519", "pub": pubOf(k.ts)},
			"r1": map[string]any{"alg": "ed25519", "pub": pubOf(k.man)},
			"r2": map[string]any{"alg": "ed25519", "pub": pubOf(k.man2)},
			"a1": map[string]any{"alg": "minisign", "pub": art.Base64()},
		},
		"roles": map[string]any{"root": rootRole, "timestamp": role("t1"), "manifest": manRole,
			"sources": role("r1"), "artifact": role("a1")}}
}

func manifestDoc(k updKeys, serial int64, expires time.Time, installer []byte) map[string]any {
	claims := updates.ArtifactClaims{Product: updProduct, Platform: updPlatform, Channel: "stable", Version: updVersion, Serial: serial}
	sig := updates.SignMinisigPrehashed(k.art, k.artID, updates.DigestOf(installer), claims.String())
	return map[string]any{"type": "manifest", "product": updProduct, "channel": "stable", "serial": serial,
		"expires": rfc(expires), "mandatory": false,
		"app": map[string]any{"version": updVersion, "assets": map[string]any{updPlatform: map[string]any{
			"path": updAsset, "sha256": hexSum(installer), "length": len(installer), "minisig": string(sig)}}}}
}

func timestampDoc(version int64, expires time.Time, serial int64, sha string, length int) map[string]any {
	return map[string]any{"type": "timestamp", "version": version, "expires": rfc(expires),
		"meta": map[string]any{updates.ManifestName("stable"): map[string]any{
			"serial": serial, "sha256": sha, "length": length}}}
}
