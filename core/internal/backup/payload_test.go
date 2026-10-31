// SPDX-License-Identifier: GPL-3.0-only

package backup

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"errors"
	"testing"
)

func TestPackUnpackRoundTrip(t *testing.T) {
	summary := []byte(`{"groups":2}`)
	snap := bytes.Repeat([]byte("SQLite format 3\x00"), 1000)
	body, err := Pack(summary, snap)
	if err != nil {
		t.Fatal(err)
	}
	gotSum, gotSnap, err := Unpack(body)
	if err != nil {
		t.Fatalf("Unpack: %v", err)
	}
	if !bytes.Equal(gotSum, summary) || !bytes.Equal(gotSnap, snap) {
		t.Fatal("данные не совпали")
	}
}

func TestUnpackRejectsMalformed(t *testing.T) {
	good, _ := Pack([]byte("{}"), []byte("snapshot"))
	notGzip := append(binary.LittleEndian.AppendUint32(nil, 2), []byte("{}not gzip")...)
	cases := map[string][]byte{
		"пусто":               nil,
		"короче префикса":     {1, 2},
		"длина сводки больше": append(binary.LittleEndian.AppendUint32(nil, 1<<30), 1, 2, 3),
		"не gzip":             notGzip,
		"обрезан gzip":        good[:len(good)-4],
		"мусор после gzip":    append(bytes.Clone(good), 0, 0, 0),
	}
	for name, body := range cases {
		if _, _, err := Unpack(body); !errors.Is(err, ErrCorrupt) {
			t.Errorf("%s: err = %v, want ErrCorrupt", name, err)
		}
	}
}

func TestPackRejectsHugeSummary(t *testing.T) {
	if _, err := Pack(make([]byte, MaxSummaryBytes+1), nil); err == nil {
		t.Fatal("сводка больше предела принята")
	}
}

// TestGzipBombCapped — S: маленький gzip, распаковывающийся в десятки МиБ,
// режется пределом, а не съедает память.
func TestGzipBombCapped(t *testing.T) {
	var gz bytes.Buffer
	zw := gzip.NewWriter(&gz)
	zero := make([]byte, 1<<20)
	for i := 0; i < 64; i++ { // 64 МиБ нулей сжимаются в ~64 КиБ
		if _, err := zw.Write(zero); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if gz.Len() > 1<<20 {
		t.Fatalf("бомба не сжалась: %d байт", gz.Len())
	}
	body := append(binary.LittleEndian.AppendUint32(nil, 2), []byte("{}")...)
	body = append(body, gz.Bytes()...)

	if _, _, err := unpackLimit(body, 1<<20); !errors.Is(err, ErrCorrupt) {
		t.Fatalf("предел 1 МиБ: err = %v, want ErrCorrupt", err)
	}
	// ровно по границе: 64 МиБ проходят при пределе 64 МиБ и не проходят при пределе на байт меньше
	if _, snap, err := unpackLimit(body, 64<<20); err != nil || len(snap) != 64<<20 {
		t.Fatalf("предел 64 МиБ: %d байт, %v", len(snap), err)
	}
	if _, _, err := unpackLimit(body, 64<<20-1); !errors.Is(err, ErrCorrupt) {
		t.Fatalf("предел 64 МиБ-1: err = %v, want ErrCorrupt", err)
	}
}
