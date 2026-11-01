// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"context"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/api"
)

// startSchedulers запускает фоновые циклы: автообновление подписок (FR-UI-126,
// T-20: группы, у которых прошёл интервал; skip_auto_update и архив
// пропускаются) и проверку обновлений приложения (T-75). Возвращённая функция
// останавливает оба.
func startSchedulers(s *api.Server) (stop func()) {
	stopSubs := s.StartSubscriptionScheduler(context.Background())
	stopUpdates := s.StartUpdateScheduler(context.Background())
	return func() {
		stopUpdates()
		stopSubs()
	}
}
