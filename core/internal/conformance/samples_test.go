// SPDX-License-Identifier: GPL-3.0-only

package conformance

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/backup"
)

// loadGenerated — образцы по закоммиченному payload.bin (без перепаковки gzip).
func loadGenerated(t *testing.T) map[string][]byte {
	t.Helper()
	gen, err := Generate(CommittedPayload(repoRoot(t)))
	if err != nil {
		t.Fatal(err)
	}
	return gen
}

func decode(t *testing.T, b []byte, v any) {
	t.Helper()
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}

// TestBackupSamples: каждый образец даёт исход из cases.json через настоящий backup.Open.
func TestBackupSamples(t *testing.T) {
	gen := loadGenerated(t)
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
