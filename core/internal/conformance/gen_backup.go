// SPDX-License-Identifier: GPL-3.0-only

package conformance

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/backup"
)

// Тестовые пароли образцов (не секреты, нигде не используются).
const (
	backupPassword = "conformance-password-1"
	backupOther    = "conformance-password-2"
)

type backupCase struct {
	File     string `json:"file"`
	Password string `json:"password"`
	Expect   string `json:"expect"` // ok | wrong_password | tampered | corrupt
	Note     string `json:"note"`
}

type argonJSON struct {
	T    uint32 `json:"t"`
	MKiB uint32 `json:"m_kib"`
	P    uint8  `json:"p"`
}

type backupCases struct {
	Description   string       `json:"description"`
	Argon2        argonJSON    `json:"argon2"`
	PayloadFile   string       `json:"payload_file"`
	PayloadSHA256 string       `json:"payload_sha256"`
	Cases         []backupCase `json:"cases"`
}

// backupOutcome переводит ошибку backup.Open в имя исхода из cases.json.
func backupOutcome(err error) string {
	switch {
	case err == nil:
		return "ok"
	case errors.Is(err, backup.ErrWrongPassword):
		return "wrong_password"
	case errors.Is(err, backup.ErrTampered):
		return "tampered"
	case errors.Is(err, backup.ErrCorrupt):
		return "corrupt"
	}
	return err.Error()
}

func flipped(b []byte, at int) []byte {
	c := append([]byte(nil), b...)
	c[at] ^= 0x01
	return c
}

func samplePayload() ([]byte, error) {
	snapshot, _ := io.ReadAll(io.LimitReader(newRand("backup-snapshot"), 2048))
	snapshot = append([]byte("SQLite format 3\x00 conformance sample\n"), snapshot...)
	summary := []byte(`{"app":"lavray","kind":"conformance-sample","schema":1}`)
	return backup.Pack(summary, bytes.NewReader(snapshot))
}

// genBackup запечатывает payload; nil — собрать заново (gzip зависит от версии
// Go, поэтому проверка читает закоммиченный payload.bin и не перепаковывает его).
func genBackup(payload []byte) (map[string][]byte, error) {
	var err error
	if payload == nil {
		if payload, err = samplePayload(); err != nil {
			return nil, err
		}
	}
	params := backup.Params{T: 1, MKiB: backup.MinMKiB, P: 1}
	opts := backup.Options{Params: params, Rand: newRand("backup-seal")}
	valid, err := backup.Seal(backupPassword, payload, opts)
	if err != nil {
		return nil, err
	}
	other, err := backup.Seal(backupOther, payload, opts)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(payload)
	doc, err := jsonDoc(backupCases{
		Description:   "Образцы LAVBK1: argon2 облегчён (t=1, m=8 МиБ, p=1); соль и nonce из фиксированного seed",
		Argon2:        argonJSON{params.T, params.MKiB, params.P},
		PayloadFile:   "backup/payload.bin",
		PayloadSHA256: hex.EncodeToString(sum[:]),
		Cases: []backupCase{
			{"valid.lavbk", backupPassword, "ok", "расшифровка даёт payload.bin"},
			{"other-password.lavbk", backupPassword, "wrong_password", "файл запечатан другим паролем"},
			{"tampered.lavbk", backupPassword, "tampered", "изменён байт шифртекста"},
			{"truncated.lavbk", backupPassword, "tampered", "отрезаны последние 5 байт"},
			{"truncated-short.lavbk", backupPassword, "corrupt", "файл короче заголовка с тегом"},
			{"bad-magic.lavbk", backupPassword, "corrupt", "изменён первый байт сигнатуры"},
		},
	})
	if err != nil {
		return nil, err
	}
	return map[string][]byte{
		"backup/payload.bin":           payload,
		"backup/valid.lavbk":           valid,
		"backup/other-password.lavbk":  other,
		"backup/tampered.lavbk":        flipped(valid, len(valid)-30),
		"backup/truncated.lavbk":       valid[:len(valid)-5],
		"backup/truncated-short.lavbk": valid[:backup.HeaderSize+4],
		"backup/bad-magic.lavbk":       flipped(valid, 0),
		"backup/cases.json":            doc,
	}, nil
}
