// SPDX-License-Identifier: GPL-3.0-only

package conformance

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// fileSource — updates.Source из одного файла; остальные имена — ErrNotFound.
type fileSource map[string][]byte

func (s fileSource) Fetch(_ context.Context, name string) ([]byte, error) {
	if b, ok := s[name]; ok {
		return b, nil
	}
	return nil, fmt.Errorf("%w: %s", updates.ErrNotFound, name)
}

type updRun struct {
	t     *testing.T
	cs    updCases
	files map[string][]byte
}

func (r updRun) file(n string) []byte { return r.files[GeneratedDir+"/updates/"+n] }

func (r updRun) trust(name string) (*updates.Trust, error) {
	if name == "" {
		name = r.cs.TrustRoot
	}
	return updates.NewTrust(r.file(name))
}

// TestUpdatesSamples прогоняет каждый кейс cases.json через настоящие функции
// пакета updates (теми же правилами, что в проде) и сверяет ошибку с исходом.
func TestUpdatesSamples(t *testing.T) {
	r := updRun{t: t, files: loadGenerated(t)}
	decode(t, r.file("cases.json"), &r.cs)
	now := refTime.Format("2006-01-02T15:04:05Z")
	if r.cs.ReferenceAt != now {
		t.Fatalf("reference_time %s", r.cs.ReferenceAt)
	}
	for _, c := range r.cs.Cases {
		want, known := outcomeErrors[c.Expect]
		if !known {
			t.Fatalf("%s: исход %q не описан", c.File, c.Expect)
		}
		err := r.run(c)
		if want == nil && err != nil || want != nil && !errors.Is(err, want) {
			t.Errorf("%s (%s): ошибка %v, ожидался исход %q (%v)", c.File, c.Kind, err, c.Expect, want)
		}
	}
}

func (r updRun) run(c updCase) error {
	switch c.Kind {
	case "root":
		tr, err := updates.NewTrust(r.file(c.File))
		if err != nil {
			return err
		}
		_, _, err = updates.AdvanceRoot(context.Background(), []updates.Source{fileSource{}}, tr, refTime)
		return err
	case "timestamp":
		tr, err := r.trust(c.TrustRoot)
		if err != nil {
			return err
		}
		_, err = updates.FetchTimestamp(context.Background(), tr, []updates.Source{fileSource{"timestamp.json": r.file(c.File)}},
			updates.TimestampPolicy{Saved: r.cs.Stored["timestamp_version"], Now: refTime})
		return err
	case "manifest":
		return r.runManifest(c)
	}
	return r.runArtifact(c)
}

func (r updRun) runManifest(c updCase) error {
	tr, err := r.trust(c.TrustRoot)
	if err != nil {
		return err
	}
	// закрепляющий timestamp разбирается без проверки подписи: она проверяется в своих кейсах
	env, err := updates.ParseEnvelope(r.file(c.Timestamp))
	if err != nil {
		return err
	}
	ts, err := updates.ParseTimestamp(env.Signed)
	if err != nil {
		return err
	}
	src := fileSource{updates.ManifestName("stable"): r.file(c.File)}
	q := updates.ManifestQuery{Channel: r.cs.Query["channel"], Product: r.cs.Query["product"],
		SavedSerial: r.cs.Stored["manifest_serial"], Now: refTime}
	_, _, err = updates.FetchManifest(context.Background(), tr, []updates.Source{src}, ts, q)
	return err
}

func (r updRun) runArtifact(c updCase) error {
	tr, err := r.trust("")
	if err != nil {
		return err
	}
	sig, err := updates.ParseMinisig(r.file(c.Minisig))
	if err != nil {
		return err
	}
	claims, err := updates.ParseClaims(r.cs.Claims["trusted_comment"])
	if err != nil {
		return err
	}
	return tr.Root().VerifyArtifactSignature(sig, updates.DigestOf(r.file(c.File)), claims)
}
