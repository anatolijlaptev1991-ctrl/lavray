// SPDX-License-Identifier: GPL-3.0-only

package conformance

import (
	"bytes"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/backup"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

func decode(t *testing.T, b []byte, v any) {
	t.Helper()
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}

// TestBackupSamples: каждый образец даёт исход из cases.json через настоящий backup.Open.
func TestBackupSamples(t *testing.T) {
	gen, err := Generate()
	if err != nil {
		t.Fatal(err)
	}
	var cs backupCases
	decode(t, gen[GeneratedDir+"/backup/cases.json"], &cs)
	payload := gen[GeneratedDir+"/"+cs.PayloadFile]
	if hexSum(payload) != cs.PayloadSHA256 {
		t.Fatal("payload_sha256 не совпадает с payload.bin")
	}
	for _, c := range cs.Cases {
		got, err := backup.Open(c.Password, gen[GeneratedDir+"/backup/"+c.File])
		if out := backupOutcome(err); out != c.Expect {
			t.Errorf("%s: исход %q, ожидался %q", c.File, out, c.Expect)
		}
		if c.Expect == "ok" && !bytes.Equal(got, payload) {
			t.Errorf("%s: расшифровка не равна payload.bin", c.File)
		}
	}
}

func classifyTimed(err error, expires time.Time, version, stored int64) string {
	switch {
	case errors.Is(err, updates.ErrInsufficientSignatures):
		return "insufficient_signatures"
	case err != nil:
		return err.Error()
	case !expires.After(refTime):
		return "expired"
	case version <= stored:
		return "rollback"
	}
	return "ok"
}

// TestUpdatesSamples: исходы cases.json получаются на настоящем updates.Trust.
func TestUpdatesSamples(t *testing.T) {
	gen, err := Generate()
	if err != nil {
		t.Fatal(err)
	}
	file := func(n string) []byte { return gen[GeneratedDir+"/updates/"+n] }
	var cs updCases
	decode(t, file("cases.json"), &cs)
	trust, err := updates.NewTrust(file(cs.TrustRoot))
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cs.Cases {
		if got := updatesOutcome(t, trust, cs, c, file); got != c.Expect {
			t.Errorf("%s: исход %q, ожидался %q", c.File, got, c.Expect)
		}
	}
}

func updatesOutcome(t *testing.T, trust *updates.Trust, cs updCases, c updCase, file func(string) []byte) string {
	t.Helper()
	switch c.Kind {
	case "root":
		tr, err := updates.NewTrust(file(c.File))
		if err != nil {
			return classifyTimed(err, time.Time{}, 0, 0)
		}
		return classifyTimed(nil, tr.Root().Expires, 2, 1)
	case "timestamp":
		env, err := trust.Verify(file(c.File), updates.RoleTimestamp)
		if err != nil {
			return classifyTimed(err, time.Time{}, 0, 0)
		}
		ts, perr := updates.ParseTimestamp(env.Signed)
		if perr != nil {
			t.Fatal(perr)
		}
		return classifyTimed(nil, ts.Expires, ts.Version, cs.Stored["timestamp_version"])
	case "manifest":
		env, err := trust.Verify(file(c.File), updates.RoleManifest)
		if err != nil {
			return classifyTimed(err, time.Time{}, 0, 0)
		}
		mf, perr := updates.ParseManifest(env.Signed)
		if perr != nil {
			t.Fatal(perr)
		}
		return classifyTimed(nil, mf.Expires, mf.Serial, cs.Stored["manifest_serial"])
	}
	return artifactOutcome(t, trust, cs, c, file)
}

func artifactOutcome(t *testing.T, trust *updates.Trust, cs updCases, c updCase, file func(string) []byte) string {
	t.Helper()
	sig, err := updates.ParseMinisig(file(cs.Claims["minisig"]))
	if err != nil {
		t.Fatal(err)
	}
	claims, err := updates.ParseClaims(cs.Claims["trusted_comment"])
	if err != nil {
		t.Fatal(err)
	}
	if err := trust.Root().VerifyArtifactSignature(sig, updates.DigestOf(file(c.File)), claims); err != nil {
		return "bad_signature"
	}
	return "ok"
}
