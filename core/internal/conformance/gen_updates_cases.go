// SPDX-License-Identifier: GPL-3.0-only

package conformance

import (
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// outcomeErrors — исход из cases.json → ошибка пакета updates, которую его
// настоящие функции возвращают в этом случае (nil — успех). bad_signature и
// insufficient_signatures в Go неразличимы по ошибке: первое — ни одной валидной
// подписи, второе — меньше порога при хотя бы одной валидной.
var outcomeErrors = map[string]error{
	"ok":                      nil,
	"bad_signature":           updates.ErrInsufficientSignatures,
	"insufficient_signatures": updates.ErrInsufficientSignatures,
	"expired":                 updates.ErrExpired,
	"rollback":                updates.ErrSerialRollback,
	"horizon":                 updates.ErrTimestampHorizon,
	"hash_mismatch":           updates.ErrHashMismatch,
	"length_mismatch":         updates.ErrLengthMismatch,
	"serial_mismatch":         updates.ErrManifestMismatch,
	"wrong_product":           updates.ErrWrongProduct,
	"wrong_channel":           updates.ErrWrongChannel,
	"claims_mismatch":         updates.ErrMinisigTrustedComment,
	"artifact_bad_signature":  updates.ErrBadSignature,
}

type updCase struct {
	File      string `json:"file"`
	Kind      string `json:"kind"`   // root | timestamp | manifest | artifact
	Expect    string `json:"expect"` // ключ outcomeErrors
	TrustRoot string `json:"trust_root,omitempty"`
	Timestamp string `json:"timestamp,omitempty"` // manifest: закрепляющий timestamp
	Minisig   string `json:"minisig,omitempty"`   // artifact: файл подписи
	Note      string `json:"note"`
}

type updCases struct {
	Description string            `json:"description"`
	ReferenceAt string            `json:"reference_time"`
	TrustRoot   string            `json:"trust_root"`
	Stored      map[string]int64  `json:"stored_state"`
	Query       map[string]string `json:"manifest_query"`
	Claims      map[string]string `json:"artifact_claims"`
	Rules       []string          `json:"rules"`
	Cases       []updCase         `json:"cases"`
}

func updatesCases(c updates.ArtifactClaims) updCases {
	return updCases{
		Description: "TUF-lite: подписи ed25519 по ролям root.json; ключи выводятся из фиксированных seed",
		ReferenceAt: rfc(refTime),
		TrustRoot:   "root.json",
		Stored:      map[string]int64{"root_version": 1, "timestamp_version": storedTS, "manifest_serial": storedSerial},
		Query:       map[string]string{"channel": "stable", "product": updProduct},
		Claims:      map[string]string{"trusted_comment": c.String(), "installer": updAsset},
		Rules: []string{
			"now = reference_time; срок: now >= expires — истёк (в том числе равенство)",
			"timestamp.expires не дальше now + 8 суток (7 + 1 допуск часов), иначе horizon",
			"откат строго: timestamp.version < сохранённой, manifest.serial < сохранённого; равенство допустимо",
			"manifest сверяется с закрепляющим timestamp: sha256, длина, serial",
			"исход — по ошибке функций пакета updates (AdvanceRoot, FetchTimestamp, FetchManifest, VerifyArtifactSignature)",
		},
		Cases: append(append(rootCases(), timestampCases()...), append(manifestCases(), artifactCases()...)...),
	}
}

func rootCases() []updCase {
	return []updCase{
		{File: "root.json", Kind: "root", Expect: "ok", Note: "порог 1, самоподпись k1"},
		{File: "root-expired.json", Kind: "root", Expect: "expired", Note: "подпись верна, срок истёк"},
		{File: "root-insufficient.json", Kind: "root", Expect: "insufficient_signatures", Note: "роль root: порог 2, подпись одна"},
	}
}

func timestampCases() []updCase {
	t := func(f, e, n string) updCase { return updCase{File: f, Kind: "timestamp", Expect: e, Note: n} }
	return []updCase{
		t("timestamp-valid.json", "ok", "версия выше сохранённой, срок в окне свежести"),
		t("timestamp-equal-version.json", "ok", "версия равна сохранённой — допустима"),
		t("timestamp-rollback.json", "rollback", "версия ниже сохранённой"),
		t("timestamp-expired.json", "expired", "срок истёк"),
		t("timestamp-horizon.json", "horizon", "срок дальше окна свежести"),
		t("timestamp-bad-signature.json", "bad_signature", "подпись чужим ключом под keyid t1"),
		t("timestamp-unknown-keyid.json", "bad_signature", "keyid t9 нет в root.json"),
	}
}

func manifestCases() []updCase {
	m := func(v, e, n string) updCase {
		return updCase{File: "manifest-stable-" + v + ".json", Kind: "manifest", Expect: e, Timestamp: "timestamp-pin-" + v + ".json", Note: n}
	}
	pin := func(p, e, n string) updCase {
		return updCase{File: "manifest-stable-valid.json", Kind: "manifest", Expect: e, Timestamp: "timestamp-pin-" + p + ".json", Note: n}
	}
	two := func(v, e, n string) updCase {
		c := m(v, e, n)
		c.TrustRoot = "root-threshold2.json"
		return c
	}
	return []updCase{
		m("valid", "ok", "serial выше сохранённого"),
		m("equal-serial", "ok", "serial равен сохранённому — допустим"),
		m("rollback", "rollback", "serial ниже сохранённого"),
		m("expired", "expired", "срок истёк"),
		m("bad-signature", "bad_signature", "подпись чужим ключом под keyid r1"),
		m("unknown-keyid", "bad_signature", "keyid r9 нет в root.json"),
		m("wrong-product", "wrong_product", "product не lavray-windows"),
		m("wrong-channel", "wrong_channel", "channel beta вместо stable"),
		pin("wrong-sha", "hash_mismatch", "sha256 в timestamp не совпал"),
		pin("wrong-length", "length_mismatch", "длина в timestamp не совпала"),
		pin("wrong-serial", "serial_mismatch", "serial в timestamp не совпал"),
		two("threshold2-one-signature", "insufficient_signatures", "роль manifest: порог 2, подпись одна"),
		two("threshold2-two-signatures", "ok", "роль manifest: порог 2, обе подписи"),
	}
}

func artifactCases() []updCase {
	a := func(f, sig, e, n string) updCase {
		return updCase{File: f, Kind: "artifact", Expect: e, Minisig: sig, Note: n}
	}
	return []updCase{
		a(updAsset, updAsset+".minisig", "ok", "minisign prehashed, trusted comment из artifact_claims"),
		a(updAsset+".tampered", updAsset+".minisig", "artifact_bad_signature", "изменён первый байт установщика"),
		a(updAsset, updAsset+".minisig-wrong-claims", "claims_mismatch", "подпись верна, trusted comment другой версии"),
	}
}
