// SPDX-License-Identifier: GPL-3.0-only

package conformance

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"math/rand/v2"
	"os"
	"path/filepath"
	"sort"
)

// GeneratedDir — каталог сгенерированных образцов от корня репозитория.
const GeneratedDir = "conformance/generated"

// newRand — детерминированный источник «случайных» байт (ChaCha8) по метке:
// соль и nonce резервных копий одинаковы при каждой генерации.
func newRand(label string) io.Reader {
	seed := sha256.Sum256([]byte("lavray-conformance/rand/" + label))
	return rand.NewChaCha8(seed)
}

func jsonDoc(v any) ([]byte, error) {
	b, err := json.MarshalIndent(v, "", "  ")
	return append(b, '\n'), err
}

// Generate строит все сгенерированные файлы в памяти: путь от корня → байты.
func Generate() (map[string][]byte, error) {
	out := map[string][]byte{}
	for _, g := range []func() (map[string][]byte, error){genBackup, genUpdates} {
		files, err := g()
		if err != nil {
			return nil, err
		}
		for name, data := range files {
			out[GeneratedDir+"/"+name] = data
		}
	}
	return out, nil
}

// WriteGenerated заменяет conformance/generated/ содержимым files.
func WriteGenerated(root string, files map[string][]byte) error {
	if err := os.RemoveAll(filepath.Join(root, GeneratedDir)); err != nil {
		return err
	}
	for name, data := range files {
		p := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(p, data, 0o644); err != nil {
			return err
		}
	}
	return nil
}

// CheckGenerated сверяет files с диском; возвращает список расхождений.
func CheckGenerated(root string, files map[string][]byte) []string {
	var bad []string
	for name, want := range files {
		got, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(name)))
		switch {
		case err != nil:
			bad = append(bad, fmt.Sprintf("нет файла %s: %v", name, err))
		case !bytes.Equal(got, want):
			bad = append(bad, "не совпадает с генератором: "+name)
		}
	}
	sort.Strings(bad)
	return bad
}
