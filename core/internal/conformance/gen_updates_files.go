// SPDX-License-Identifier: GPL-3.0-only

package conformance

import (
	"crypto/ed25519"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// updBuilder копит файлы и первую ошибку.
type updBuilder struct {
	files map[string][]byte
	err   error
}

func (u *updBuilder) put(name string, b []byte, err error) {
	if u.err == nil {
		u.err = err
	}
	u.files["updates/"+name] = b
}

// env кладёт конверт, подписанный парами keyid, ключ.
func (u *updBuilder) env(name string, doc map[string]any, signers ...any) {
	b, err := envelope(doc, signers...)
	u.put(name, b, err)
}

func roleOf(threshold int, ids ...string) map[string]any {
	return map[string]any{"keyids": ids, "threshold": threshold}
}

func (u *updBuilder) roots(k updKeys) {
	one, two := roleOf(1, "k1"), roleOf(2, "k1", "k2")
	man1, man2 := roleOf(1, "r1"), roleOf(2, "r1", "r2")
	u.env("root.json", rootDoc(k, farFuture, one, man1), "k1", k.root)
	u.env("root-insufficient.json", rootDoc(k, farFuture, two, man1), "k1", k.root)
	u.env("root-expired.json", rootDoc(k, longPast, one, man1), "k1", k.root)
	u.env("root-threshold2.json", rootDoc(k, farFuture, one, man2), "k1", k.root)
}

// timestamps — timestamp-*.json относительно сохранённой версии storedTS; все они
// закрепляют валидный манифест (signed — его подписанные байты).
func (u *updBuilder) timestamps(k updKeys, signed []byte) {
	sha, n, serial := hexSum(signed), len(signed), storedSerial+1
	mk := func(name string, version int64, exp time.Time, keyID string, key ed25519.PrivateKey) {
		u.env(name, timestampDoc(version, exp, serial, sha, n), keyID, key)
	}
	mk("timestamp-valid.json", storedTS+1, tsFresh, "t1", k.ts)
	mk("timestamp-equal-version.json", storedTS, tsFresh, "t1", k.ts)
	mk("timestamp-rollback.json", storedTS-1, tsFresh, "t1", k.ts)
	mk("timestamp-expired.json", storedTS+1, longPast, "t1", k.ts)
	mk("timestamp-horizon.json", storedTS+1, tsFar, "t1", k.ts)
	mk("timestamp-bad-signature.json", storedTS+1, tsFresh, "t1", k.other)
	mk("timestamp-unknown-keyid.json", storedTS+1, tsFresh, "t9", k.ts)
	// закрепление неверных sha256, длины и serial у валидного манифеста
	u.env("timestamp-pin-wrong-sha.json", timestampDoc(storedTS+1, tsFresh, serial, hexSum([]byte("x")), n), "t1", k.ts)
	u.env("timestamp-pin-wrong-length.json", timestampDoc(storedTS+1, tsFresh, serial, sha, n+1), "t1", k.ts)
	u.env("timestamp-pin-wrong-serial.json", timestampDoc(storedTS+1, tsFresh, serial+1, sha, n), "t1", k.ts)
}

// manifestVariant — manifest-stable-<name>.json и timestamp-pin-<name>.json,
// закрепляющий именно его (serial, sha256, длина).
func (u *updBuilder) manifestVariant(k updKeys, name string, doc map[string]any, signers ...any) {
	u.env("manifest-stable-"+name+".json", doc, signers...)
	signed := signedBytes(doc)
	serial, _ := doc["serial"].(int64)
	u.env("timestamp-pin-"+name+".json", timestampDoc(storedTS+1, tsFresh, serial, hexSum(signed), len(signed)), "t1", k.ts)
}

// manifests кладёт варианты манифеста; возвращает подписанные байты валидного.
func (u *updBuilder) manifests(k updKeys, installer []byte) []byte {
	mk := func(serial int64, exp time.Time) map[string]any { return manifestDoc(k, serial, exp, installer) }
	good := mk(storedSerial+1, farFuture)
	u.manifestVariant(k, "valid", good, "r1", k.man)
	u.manifestVariant(k, "equal-serial", mk(storedSerial, farFuture), "r1", k.man)
	u.manifestVariant(k, "rollback", mk(storedSerial-2, farFuture), "r1", k.man)
	u.manifestVariant(k, "expired", mk(storedSerial+1, longPast), "r1", k.man)
	u.manifestVariant(k, "bad-signature", good, "r1", k.other)
	u.manifestVariant(k, "unknown-keyid", good, "r9", k.man)
	u.manifestVariant(k, "threshold2-one-signature", good, "r1", k.man)
	u.manifestVariant(k, "threshold2-two-signatures", good, "r1", k.man, "r2", k.man2)
	wrongProduct, wrongChannel := mk(storedSerial+1, farFuture), mk(storedSerial+1, farFuture)
	wrongProduct["product"], wrongChannel["channel"] = "lavray-linux", "beta"
	u.manifestVariant(k, "wrong-product", wrongProduct, "r1", k.man)
	u.manifestVariant(k, "wrong-channel", wrongChannel, "r1", k.man)
	return signedBytes(good)
}

func genUpdates() (map[string][]byte, error) {
	k := newUpdKeys()
	installer := []byte("conformance installer " + updVersion + "\n")
	u := &updBuilder{files: map[string][]byte{}}
	u.roots(k)
	u.timestamps(k, u.manifests(k, installer))
	claims := updates.ArtifactClaims{Product: updProduct, Platform: updPlatform, Channel: "stable", Version: updVersion, Serial: storedSerial + 1}
	other := claims
	other.Version = "9.9.9"
	digest := updates.DigestOf(installer)
	u.put(updAsset, installer, nil)
	u.put(updAsset+".minisig", updates.SignMinisigPrehashed(k.art, k.artID, digest, claims.String()), nil)
	u.put(updAsset+".minisig-wrong-claims", updates.SignMinisigPrehashed(k.art, k.artID, digest, other.String()), nil)
	u.put(updAsset+".tampered", flipped(installer, 0), nil)
	doc, err := jsonDoc(updatesCases(claims))
	u.put("cases.json", doc, err)
	return u.files, u.err
}
