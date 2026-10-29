// SPDX-License-Identifier: GPL-3.0-only

package api

// Сохранение импортированных профилей и «ручные» серверы подписки (T-51,
// A1-16, B1-27, B1-35).

import (
	"encoding/json"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
)

// isSubscriptionGroup — группа создана как подписка. Профили, которые
// пользователь кладёт в такую группу сам, помечаются model.Profile.Manual:
// обновление подписки их не удаляет.
func (s *Server) isSubscriptionGroup(id int64) bool {
	g, err := s.st.GetGroup(id)
	return err == nil && g.Kind == model.GroupSubscription
}

// importKey — отпечаток «того же сервера» для дедупликации импорта: канонический
// JSON профиля без служебных и пользовательских полей (id, группа, имя,
// избранное, заметки, теги, страна, результаты тестов, трафик, времена).
// Имя не входит в ключ: провайдер переименовал сервер — это тот же сервер.
// Пустая строка — ключ построить не удалось, профиль считается новым.
func importKey(p *model.Profile) string {
	c := *p
	c.ID, c.GroupID, c.Name = 0, 0, ""
	c.Favorite, c.Tags, c.Notes, c.Geo, c.Manual = false, nil, "", "", false
	c.TestResult, c.Traffic = model.TestResult{}, model.TrafficCounters{}
	c.CreatedAtMs, c.UpdatedAtMs = 0, 0
	b, err := json.Marshal(&c)
	if err != nil {
		return ""
	}
	return string(b)
}

// commitImport сохраняет разобранные профили в группу ОДНОЙ транзакцией и
// пропускает уже имеющиеся (в группе или раньше в этом же списке). Раньше
// каждый профиль создавался отдельной транзакцией: повторный импорт той же
// ссылки давал дубль, а сбой посреди списка оставлял половину.
// Возвращает id созданных профилей и число пропущенных дублей.
func (s *Server) commitImport(groupID int64, list []*model.Profile) (added []int64, skipped int, err error) {
	existing, err := s.st.ListProfiles(groupID)
	if err != nil {
		return nil, 0, err
	}
	seen := make(map[string]bool, len(existing)+len(list))
	for _, p := range existing {
		if k := importKey(p); k != "" {
			seen[k] = true
		}
	}
	manual := s.isSubscriptionGroup(groupID)
	var fresh []*model.Profile
	for _, p := range list {
		if k := importKey(p); k != "" {
			if seen[k] {
				skipped++
				continue
			}
			seen[k] = true
		}
		p.ID = 0
		p.GroupID = groupID
		p.Manual = manual
		fresh = append(fresh, p)
	}
	err = s.st.InTx(func(tx *store.Store) error {
		for _, p := range fresh {
			if err := tx.CreateProfile(p); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, 0, err
	}
	for _, p := range fresh {
		added = append(added, p.ID)
	}
	return added, skipped, nil
}
