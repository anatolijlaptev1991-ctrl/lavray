// SPDX-License-Identifier: GPL-3.0-only

package presets

// ui_sync_test.go — каждый встроенный набор известен интерфейсу: он есть в
// BUILTIN (ui/src/lib/presets.ts), а ключи его названия и описания — во всех
// словарях. Иначе карточка показывает сырый id без описания: так вышло с
// lav-openwrt — файл набора добавили, в словарь интерфейса — нет.

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// repoUIDir — словари интерфейса в корне репозитория.
const repoUIDir = "../../../ui/src/lib"

// uiLanguages — языки словарей интерфейса.
var uiLanguages = []string{"ru", "en", "zh", "es", "de"}

func TestBuiltinKnownToUI(t *testing.T) {
	src, err := os.ReadFile(filepath.Join(repoUIDir, "presets.ts"))
	if err != nil {
		t.Fatalf("интерфейс недоступен (запуск вне дерева репо?): %v", err)
	}
	dicts := map[string]string{}
	for _, lang := range uiLanguages {
		raw, err := os.ReadFile(filepath.Join(repoUIDir, "dictionaries", lang+".ts"))
		if err != nil {
			t.Fatal(err)
		}
		dicts[lang] = string(raw)
	}
	for _, name := range BuiltinFiles {
		id := strings.TrimSuffix(name, ".json")
		q := regexp.QuoteMeta(id)
		// Строка таблицы: 'lav-ru': { name: …, descKey: 'preset.lavru.desc' },
		entry := regexp.MustCompile(`(?m)^\s*(?:'` + q + `'|` + q + `):\s*\{(.*)$`).FindStringSubmatch(string(src))
		if entry == nil {
			t.Errorf("%s: нет в BUILTIN (ui/src/lib/presets.ts) — карточка показывает сырой id без описания; добавьте запись и описания в словари", id)
			continue
		}
		for _, field := range []string{"nameKey", "descKey"} {
			key := regexp.MustCompile(field + `:\s*'([^']+)'`).FindStringSubmatch(entry[1])
			if key == nil {
				continue // nameKey нет у наборов с непереводимым названием-брендом
			}
			for _, lang := range uiLanguages {
				if !strings.Contains(dicts[lang], `"`+key[1]+`": `) {
					t.Errorf("%s: %s %q нет в словаре ui/src/lib/dictionaries/%s.ts", id, field, key[1], lang)
				}
			}
		}
	}
}
