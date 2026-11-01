// SPDX-License-Identifier: GPL-3.0-only

// rootstore.go — хранение принятого корня доверия между запусками (в
// настройке update.root_json, которую SetSettings не принимает). Версия
// корня не понижается: вшитый в сборку корень никогда не «перебивает» более
// новый принятый, а новая сборка с более новым вшитым корнем — перебивает
// сохранённый.
package updates

import "fmt"

// RootStore — хранилище принятого корня (внедряется: api — настройки ядра).
type RootStore interface {
	// LoadRoot возвращает сохранённый root.json или nil, если его нет.
	LoadRoot() ([]byte, error)
	// SaveRoot сохраняет root.json (проверку монотонности делает PersistRoot).
	SaveRoot(raw []byte) error
}

// ResolveTrust выбирает стартовый корень: вшитый в сборку либо сохранённый,
// если его версия строго выше. Нет вшитого корня — ErrNotConfigured (обновления
// не настроены в этой сборке). Испорченный сохранённый корень игнорируется.
func ResolveTrust(embedded []byte, store RootStore) (*Trust, error) {
	if len(embedded) == 0 {
		return nil, ErrNotConfigured
	}
	base, err := NewTrust(embedded)
	if err != nil {
		return nil, fmt.Errorf("вшитый root.json: %w", err)
	}
	if store == nil {
		return base, nil
	}
	raw, err := store.LoadRoot()
	if err != nil || len(raw) == 0 {
		return base, nil
	}
	saved, err := NewTrust(raw)
	if err != nil || saved.Root().Version <= base.Root().Version {
		return base, nil
	}
	return saved, nil
}

// PersistRoot сохраняет корень, если его версия выше сохранённой (повторное
// сохранение той же версии ничего не делает — идемпотентно). Понижение —
// молча игнорируется: решение «не откатываться» принадлежит хранилищу.
func PersistRoot(store RootStore, t *Trust) error {
	if store == nil || t == nil {
		return nil
	}
	if raw, err := store.LoadRoot(); err == nil && len(raw) > 0 {
		if saved, perr := NewTrust(raw); perr == nil && saved.Root().Version >= t.Root().Version {
			return nil
		}
	}
	return store.SaveRoot(t.Raw())
}
