// Package headless — сервисный режим без UI-оболочки (W8): автозапуск
// последнего профиля при старте, авторестарт после сбоя (CORE_STATE_
// RECONNECTING), обработка shutdown-сигналов. Используется lavrayd
// (OpenWrt) и режимом службы Windows, когда оболочка не поднята.
package headless

import (
	"context"
	"time"
)

// CoreAPI — поверхность ядра для headless (реализует api.Server).
type CoreAPI interface {
	// ConnectLast подключает последний/запомненный профиль (CoreService.
	// Connect с remember-источником); возвращает ошибку запуска.
	ConnectLast(ctx context.Context) error
	// StatusAlive — инстанс работает (эквивалент CORE_STATE_CONNECTED).
	StatusAlive() bool
}

// Options — поведение headless-цикла.
type Options struct {
	// ReconnectDelay — пауза между попытками авторестарта после сбоя
	// (0 → 3с; экспоненциальный рост не нужен: ниже watchdog-уровня).
	ReconnectDelay time.Duration
	// MaxAttempts — 0 = бесконечно (сервисный режим).
	MaxAttempts int
}

// Loop — запуск цикла: первичный ConnectLast, затем авторестарт при
// падении до закрытия ctx. Возвращает ошибку только если исчерпаны
// попытки; ctx.Cancel = чистый выход (текущее соединение оставляем —
// им управляет вызывающий Shutdown-поток).
func Loop(ctx context.Context, core CoreAPI, opts Options) error {
	delay := opts.ReconnectDelay
	if delay <= 0 {
		delay = 3 * time.Second
	}
	attempt := 0
	for {
		err := core.ConnectLast(ctx)
		attempt++
		if err == nil {
			attempt = 0
			// Ждём падения или выхода.
			<-waitForDeath(ctx, core)
			if ctx.Err() != nil {
				return nil
			}
			// Упало — цикл рестарта.
		}
		if opts.MaxAttempts > 0 && attempt >= opts.MaxAttempts {
			return err
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(delay):
		}
	}
}

func waitForDeath(ctx context.Context, core CoreAPI) <-chan struct{} {
	ch := make(chan struct{})
	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				close(ch)
				return
			case <-t.C:
				if !core.StatusAlive() {
					close(ch)
					return
				}
			}
		}
	}()
	return ch
}
