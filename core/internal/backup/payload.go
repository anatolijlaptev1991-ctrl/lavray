// SPDX-License-Identifier: GPL-3.0-only

package backup

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"fmt"
	"io"
)

// Пределы внутреннего контейнера.
const (
	// MaxSummaryBytes — предел JSON-сводки.
	MaxSummaryBytes = 64 << 10
	// MaxSnapshotBytes — предел снимка БД после распаковки gzip (защита от
	// «бомбы»: тело копии ограничено 64 МиБ, а SQLite сжимается хорошо).
	MaxSnapshotBytes = 256 << 20
)

// Pack собирает тело под шифрование: u32 len ‖ summary JSON ‖ gzip(snapshot).
func Pack(summary, snapshot []byte) ([]byte, error) {
	if len(summary) > MaxSummaryBytes {
		return nil, fmt.Errorf("backup: сводка больше %d байт", MaxSummaryBytes)
	}
	var buf bytes.Buffer
	buf.Write(binary.LittleEndian.AppendUint32(nil, uint32(len(summary))))
	buf.Write(summary)
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(snapshot); err != nil {
		return nil, fmt.Errorf("backup: gzip: %w", err)
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("backup: gzip: %w", err)
	}
	return buf.Bytes(), nil
}

// Unpack разбирает тело, расшифрованное Open, и возвращает сводку и снимок.
// Любое отступление от формата — ErrCorrupt.
func Unpack(body []byte) (summary, snapshot []byte, err error) {
	return unpackLimit(body, MaxSnapshotBytes)
}

func unpackLimit(body []byte, maxSnapshot int64) (summary, snapshot []byte, err error) {
	if len(body) < 4 {
		return nil, nil, fmt.Errorf("%w: тело короче префикса длины", ErrCorrupt)
	}
	n := binary.LittleEndian.Uint32(body)
	if n > MaxSummaryBytes || int64(n) > int64(len(body)-4) {
		return nil, nil, fmt.Errorf("%w: длина сводки %d", ErrCorrupt, n)
	}
	summary = body[4 : 4+n]
	rd := bytes.NewReader(body[4+n:])
	zr, err := gzip.NewReader(rd)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: gzip: %v", ErrCorrupt, err)
	}
	zr.Multistream(false)
	snapshot, err = io.ReadAll(io.LimitReader(zr, maxSnapshot+1))
	if err != nil {
		return nil, nil, fmt.Errorf("%w: gzip: %v", ErrCorrupt, err)
	}
	if int64(len(snapshot)) > maxSnapshot {
		return nil, nil, fmt.Errorf("%w: снимок после распаковки больше %d байт", ErrCorrupt, maxSnapshot)
	}
	if rd.Len() != 0 {
		return nil, nil, fmt.Errorf("%w: данные после gzip", ErrCorrupt)
	}
	return summary, snapshot, nil
}
