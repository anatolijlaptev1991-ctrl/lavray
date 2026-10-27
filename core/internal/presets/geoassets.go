// geoassets.go — встроенные geo-базы (.srs) для встроенных пресетов.
//
// Зачем embed: без этих файлов ЛЮБОЙ запуск с пресетом падал на старте
// sing-box («open .../geosite/openai.srs: The system cannot find the path»),
// то есть приложение не подключалось вообще. Теперь базы едут внутри
// бинарника и распаковываются в каталог данных при первом запуске.
//
// Обновление: релизная подсистема (UPDATE-SYSTEM §8, канал GEO) кладёт
// новые .srs в тот же каталог с более высокой ревизией — файлы в данных
// приоритетнее встроенных, поэтому гео-обновления не требуют пересборки.
package presets

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

//go:embed geo
var geoFS embed.FS

// GeoRevision — ревизия встроенного набора (растёт при обновлении баз).
const GeoRevision = 1

// ExtractGeo распаковывает встроенные .srs в dir (если файла нет или он
// старее встроенного). Возвращает число записанных файлов.
func ExtractGeo(dir string) (int, error) {
	if dir == "" {
		return 0, fmt.Errorf("geo: пустой каталог")
	}
	written := 0
	err := fs.WalkDir(geoFS, "geo", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel("geo", path)
		if err != nil {
			return err
		}
		dst := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
			return err
		}
		// Существующий файл не перезаписываем: если гео-обновление уже
		// положило более свежую базу, встроенная не должна её откатывать.
		if st, statErr := os.Stat(dst); statErr == nil && st.Size() > 0 {
			return nil
		}
		raw, err := geoFS.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.WriteFile(dst, raw, 0o600); err != nil {
			return err
		}
		written++
		return nil
	})
	if err != nil {
		return written, fmt.Errorf("geo: распаковка: %w", err)
	}
	// Маркер ревизии — для диагностики/обновлений.
	marker := filepath.Join(dir, "revision.txt")
	_ = os.WriteFile(marker,
		[]byte(fmt.Sprintf("%d %s\n", GeoRevision, time.Now().UTC().Format(time.RFC3339))),
		0o600)
	return written, nil
}

// EnsureGeo — распаковка только при первом запуске (маркер отсутствует).
func EnsureGeo(dataDir string) error {
	dir := filepath.Join(dataDir, "geo")
	if _, err := os.Stat(filepath.Join(dir, "revision.txt")); err == nil {
		return nil
	}
	_, err := ExtractGeo(dir)
	return err
}
