// SPDX-License-Identifier: GPL-3.0-only

package conformance

import (
	"crypto/ed25519"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

type updCase struct {
	File   string `json:"file"`
	Kind   string `json:"kind"`   // root | timestamp | manifest | artifact
	Expect string `json:"expect"` // ok | expired | rollback | insufficient_signatures | bad_signature
	Note   string `json:"note"`
}

type updCases struct {
	Description string            `json:"description"`
	ReferenceAt string            `json:"reference_time"`
	TrustRoot   string            `json:"trust_root"`
	Stored      map[string]int64  `json:"stored_state"`
	MetaKey     string            `json:"timestamp_meta_key"`
	Claims      map[string]string `json:"artifact_claims"`
	Cases       []updCase         `json:"cases"`
}

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

func (u *updBuilder) env(name string, doc map[string]any, keyID string, key ed25519.PrivateKey) {
	b, err := envelope(doc, keyID, key)
	u.put(name, b, err)
}

func genUpdates() (map[string][]byte, error) {
	k := newUpdKeys()
	installer := []byte("conformance installer " + updVersion + "\n")
	good := manifestDoc(k, storedSerial+1, farFuture, installer)
	u := &updBuilder{files: map[string][]byte{}}
	rootOne := map[string]any{"keyids": []string{"k1"}, "threshold": 1}
	rootTwo := map[string]any{"keyids": []string{"k1", "k2"}, "threshold": 2}
	u.env("root.json", rootDoc(k, farFuture, rootOne), "k1", k.root)
	u.env("root-insufficient.json", rootDoc(k, farFuture, rootTwo), "k1", k.root)
	u.env("root-expired.json", rootDoc(k, longPast, rootOne), "k1", k.root)
	u.env("manifest-stable-valid.json", good, "r1", k.man)
	u.env("manifest-stable-expired.json", manifestDoc(k, storedSerial+1, longPast, installer), "r1", k.man)
	u.env("manifest-stable-rollback.json", manifestDoc(k, storedSerial-2, farFuture, installer), "r1", k.man)
	u.env("manifest-stable-insufficient.json", good, "r1", k.other)
	mf := signedBytes(good)
	u.env("timestamp-valid.json", timestampDoc(storedTS+1, farFuture, storedSerial+1, mf), "t1", k.ts)
	u.env("timestamp-expired.json", timestampDoc(storedTS+1, longPast, storedSerial+1, mf), "t1", k.ts)
	u.env("timestamp-rollback.json", timestampDoc(storedTS-1, farFuture, storedSerial+1, mf), "t1", k.ts)
	u.env("timestamp-insufficient.json", timestampDoc(storedTS+1, farFuture, storedSerial+1, mf), "t1", k.other)
	claims := updates.ArtifactClaims{Product: updProduct, Platform: updPlatform, Channel: "stable", Version: updVersion, Serial: storedSerial + 1}
	u.put(updAsset, installer, nil)
	u.put(updAsset+".minisig", updates.SignMinisigPrehashed(k.art, k.artID, updates.DigestOf(installer), claims.String()), nil)
	u.put(updAsset+".tampered", flipped(installer, 0), nil)
	doc, err := jsonDoc(updatesCases(claims))
	u.put("cases.json", doc, err)
	return u.files, u.err
}

func updatesCases(c updates.ArtifactClaims) updCases {
	return updCases{
		Description: "TUF-lite: подписи ed25519 по ролям root.json; все ключи выводятся из фиксированных seed",
		ReferenceAt: rfc(refTime),
		TrustRoot:   "root.json",
		Stored:      map[string]int64{"root_version": 1, "timestamp_version": storedTS, "manifest_serial": storedSerial},
		MetaKey:     updates.ManifestName("stable"),
		Claims:      map[string]string{"trusted_comment": c.String(), "installer": updAsset, "minisig": updAsset + ".minisig"},
		Cases: []updCase{
			{"root.json", "root", "ok", "порог 1, самоподпись k1"},
			{"root-expired.json", "root", "expired", "подпись верна, срок истёк на момент reference_time"},
			{"root-insufficient.json", "root", "insufficient_signatures", "роль root: порог 2, подпись одна"},
			{"timestamp-valid.json", "timestamp", "ok", "версия выше сохранённой"},
			{"timestamp-expired.json", "timestamp", "expired", "срок истёк"},
			{"timestamp-rollback.json", "timestamp", "rollback", "версия ниже сохранённой"},
			{"timestamp-insufficient.json", "timestamp", "insufficient_signatures", "подпись чужим ключом под keyid t1"},
			{"manifest-stable-valid.json", "manifest", "ok", "serial выше сохранённого"},
			{"manifest-stable-expired.json", "manifest", "expired", "срок истёк"},
			{"manifest-stable-rollback.json", "manifest", "rollback", "serial ниже сохранённого"},
			{"manifest-stable-insufficient.json", "manifest", "insufficient_signatures", "подпись чужим ключом под keyid r1"},
			{updAsset, "artifact", "ok", "minisign prehashed, trusted comment из artifact_claims"},
			{updAsset + ".tampered", "artifact", "bad_signature", "изменён первый байт установщика"},
		},
	}
}
