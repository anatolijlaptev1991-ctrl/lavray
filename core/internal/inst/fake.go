// SPDX-License-Identifier: GPL-3.0-only

package inst

import (
	"context"
	"errors"
	"sync"
	"time"
)

// FakeRunner — детерминированный раннер для тестов (api-строят e2e-тесты
// «Connect → Status → Disconnect» без sing-box). Поведение задаётся полями
// (nil — успех по умолчанию):
//
//   - StartErr/StopErr — возвращаемые ошибки;
//   - StartDelay/StopDelay — задержки (имитация медленного старта/закрытия);
//   - StopSlowAfter — если Stop не уложился в этот интервал, а ctx уже
//     истёк — ошибка (имитация «не закрылся вовремя»);
//   - FailStartCtx — Start уважает ctx (отмена до конца задержки → ошибка).
type FakeRunner struct {
	mu           sync.Mutex
	started      bool
	lastConfig   []byte
	StartErr     error
	StopErr      error
	StartDelay   time.Duration
	StopDelay    time.Duration
	FailStartCtx bool
	// StartedCounter/StopCalls — для assertions.
	StartedCounter int
	StopCalls      int
}

// Start имитирует старт: задержка, учёт ctx, конфиг запоминается.
func (f *FakeRunner) Start(ctx context.Context, configJSON []byte) error {
	f.mu.Lock()
	f.StartedCounter++
	f.mu.Unlock()
	if f.StartDelay > 0 {
		select {
		case <-time.After(f.StartDelay):
		case <-ctx.Done():
			if f.FailStartCtx {
				return ctx.Err()
			}
		}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.StartErr != nil {
		return f.StartErr
	}
	if f.started {
		return errors.New("fake: уже запущен")
	}
	f.started = true
	f.lastConfig = append([]byte(nil), configJSON...)
	return nil
}

// Stop имитирует graceful-закрытие.
func (f *FakeRunner) Stop(ctx context.Context) error {
	f.mu.Lock()
	f.StopCalls++
	wasStarted := f.started
	f.mu.Unlock()
	if f.StopDelay > 0 {
		select {
		case <-time.After(f.StopDelay):
		case <-ctx.Done():
			// graceful-лестница: не успели — ошибка (менеджер уйдёт в Crashed)
			return ctx.Err()
		}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.StopErr != nil {
		return f.StopErr
	}
	if !wasStarted {
		return nil // Stop после неудачного Start — no-op
	}
	f.started = false
	return nil
}

// Running — запущен ли раннер сейчас.
func (f *FakeRunner) Running() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.started
}

// LastConfig — конфиг последнего успешного старта.
func (f *FakeRunner) LastConfig() []byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]byte(nil), f.lastConfig...)
}
