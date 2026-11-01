// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

// canonical приводит JSON к каноническому виду: ключи по алфавиту, без
// пробелов, числа без потери точности. Подписывается именно этот байтовый вид.
func canonical(raw []byte) ([]byte, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, fmt.Errorf("JSON не разбирается: %w", err)
	}
	if dec.More() {
		return nil, fmt.Errorf("после JSON-документа есть лишнее содержимое")
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// signEnvelope подписывает signed каждым ключом (keyid → ключ) и собирает
// конверт {"signed", "signatures"} с подписями в порядке keyid.
func signEnvelope(signed []byte, keys map[string]secretKey) ([]byte, error) {
	ids := make([]string, 0, len(keys))
	for id := range keys {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	sigs := make([]map[string]string, 0, len(ids))
	for _, id := range ids {
		sig := ed25519.Sign(keys[id].priv, signed)
		sigs = append(sigs, map[string]string{"keyid": id, "sig": base64.StdEncoding.EncodeToString(sig)})
	}
	return marshalPlain(map[string]any{"signed": json.RawMessage(signed), "signatures": sigs})
}

// marshalPlain — json.Marshal без HTML-экранирования: стандартный Marshal
// превращает «<», «>» и «&» внутри json.RawMessage в экранированные последовательности (u003c, u003e, u0026) и
// тем меняет подписанные байты (подпись перестаёт сходиться). Для всего, что
// подписывается или каноникализируется, используется только эта функция.
func marshalPlain(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// signDoc — каноникализация черновика и подпись одним или несколькими ключами.
func signDoc(draft []byte, keys map[string]secretKey) ([]byte, error) {
	signed, err := canonical(draft)
	if err != nil {
		return nil, err
	}
	return signEnvelope(signed, keys)
}

// readAndSign читает черновик из файла in, подписывает и пишет конверт в out.
func readAndSign(in, out string, keys map[string]secretKey) ([]byte, error) {
	draft, err := os.ReadFile(in)
	if err != nil {
		return nil, err
	}
	env, err := signDoc(draft, keys)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", in, err)
	}
	return env, writeFile(out, append(env, '\n'), 0o644)
}

// expiresAt — момент истечения: now + срок.
func expiresAt(now time.Time, ttl time.Duration) string {
	return now.UTC().Add(ttl).Format(time.RFC3339)
}

func parseSignedSources(env []byte) (*updates.Sources, error) {
	e, err := updates.ParseEnvelope(env)
	if err != nil {
		return nil, err
	}
	return updates.ParseSources(e.Signed)
}

// withDefault добавляет поле, если его нет.
func withDefault(doc []byte, key string, val any) ([]byte, error) {
	var m map[string]any
	if err := json.Unmarshal(doc, &m); err != nil {
		return nil, err
	}
	if _, has := m[key]; !has {
		m[key] = val
	}
	return marshalPlain(m)
}
