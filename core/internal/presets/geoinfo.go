// SPDX-License-Identifier: GPL-3.0-only

package presets

// geoinfo.go — сведения о гео-наборе для апдейтера (T-75/7.5): что поставляется
// внутри бинарника, какая ревизия записана в каталоге и годится ли файл как .srs.

import "sort"

// GeoMarkerFile — имя маркера ревизии в каталоге geo («<ревизия> <время>»).
const GeoMarkerFile = geoMarker

// ValidSRS: файл похож на целый .srs sing-box (магия, версия, читаемый zlib-поток).
func ValidSRS(raw []byte) bool { return validSRS(raw) }

// GeoRevisionOf — ревизия из маркера каталога dir; 0, если маркера нет.
func GeoRevisionOf(dir string) int { return readGeoRevision(dir) }

// EmbeddedGeoFiles — пути файлов встроенного набора («geosite/openai.srs»),
// отсортированные. Каталог поставки обязан содержать их все: иначе пресет,
// ссылающийся на отсутствующий набор, не запустится.
func EmbeddedGeoFiles() ([]string, error) {
	entries, err := geoManifest()
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.rel)
	}
	sort.Strings(out)
	return out, nil
}
