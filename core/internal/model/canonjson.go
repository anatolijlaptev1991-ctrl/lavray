// SPDX-License-Identifier: GPL-3.0-only

package model

// canonjson.go — канонический вид JSON для хэша custom-полей (T-08B). Два
// документа с одним смыслом дают одну строку: ключи объектов отсортированы,
// пробелов нет, \u-экранирование нормализовано, числа сохраняются текстом
// (json.Number, без округления до float64), HTML не экранируется.
// Дубли ключей отвергаются: наш разбор и разбор sing-box могли бы понять такой
// документ по-разному, и подтверждённое содержимое разошлось бы с применённым.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
)

// maxCanonDepth — предел вложенности (у encoding/json свой предел 10000; наш
// меньше, чтобы рекурсия обхода оставалась короткой).
const maxCanonDepth = 512

// ErrDuplicateKey — в объекте JSON один ключ встречается дважды.
var ErrDuplicateKey = errors.New("повторяющийся ключ в объекте JSON")

// CanonicalJSON возвращает канонический вид документа raw. Пустой (или из
// одних пробелов) документ — пустая строка без ошибки.
func CanonicalJSON(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "", nil
	}
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.UseNumber()
	var out bytes.Buffer
	if err := canonValue(dec, &out, 0); err != nil {
		return "", err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return "", errors.New("после документа JSON есть лишние данные")
	}
	return out.String(), nil
}

// canonValue читает одно значение из dec и пишет его канонический вид в out.
func canonValue(dec *json.Decoder, out *bytes.Buffer, depth int) error {
	if depth > maxCanonDepth {
		return fmt.Errorf("вложенность JSON больше %d", maxCanonDepth)
	}
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	switch v := tok.(type) {
	case json.Delim:
		if v == '{' {
			return canonObject(dec, out, depth)
		}
		if v == '[' {
			return canonArray(dec, out, depth)
		}
		return fmt.Errorf("неожиданный разделитель %q", v)
	case string:
		return writeString(out, v)
	case json.Number:
		out.WriteString(v.String())
	case bool:
		if v {
			out.WriteString("true")
		} else {
			out.WriteString("false")
		}
	case nil:
		out.WriteString("null")
	default:
		return fmt.Errorf("неожиданный токен %T", tok)
	}
	return nil
}

// canonObject — тело объекта после '{': ключи по порядку байтов UTF-8.
func canonObject(dec *json.Decoder, out *bytes.Buffer, depth int) error {
	members := map[string]string{}
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return err
		}
		key, ok := tok.(string)
		if !ok {
			return fmt.Errorf("ключ объекта не строка: %v", tok)
		}
		if _, dup := members[key]; dup {
			return fmt.Errorf("%w: %q", ErrDuplicateKey, key)
		}
		var val bytes.Buffer
		if err := canonValue(dec, &val, depth+1); err != nil {
			return err
		}
		members[key] = val.String()
	}
	if _, err := dec.Token(); err != nil { // '}'
		return err
	}
	keys := make([]string, 0, len(members))
	for k := range members {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out.WriteByte('{')
	for i, k := range keys {
		if i > 0 {
			out.WriteByte(',')
		}
		if err := writeString(out, k); err != nil {
			return err
		}
		out.WriteByte(':')
		out.WriteString(members[k])
	}
	out.WriteByte('}')
	return nil
}

// canonArray — тело массива после '['; порядок элементов значим.
func canonArray(dec *json.Decoder, out *bytes.Buffer, depth int) error {
	out.WriteByte('[')
	for i := 0; dec.More(); i++ {
		if i > 0 {
			out.WriteByte(',')
		}
		if err := canonValue(dec, out, depth+1); err != nil {
			return err
		}
	}
	if _, err := dec.Token(); err != nil { // ']'
		return err
	}
	out.WriteByte(']')
	return nil
}

// writeString — строка JSON без HTML-экранирования (<, >, & как есть).
func writeString(out *bytes.Buffer, s string) error {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(s); err != nil {
		return err
	}
	out.Write(bytes.TrimSuffix(buf.Bytes(), []byte("\n")))
	return nil
}
