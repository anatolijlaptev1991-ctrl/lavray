//go:build singbox_run

// singbox.go — реальный раннер sing-box (форк 628a9ed, см. NEKO_PATCHES.md).
// ЗА BUILD-ТЕГОМ //go:build singbox_run: локальная сборка без сети не может
// скачать модуль форка (go.mod: replace github.com/sagernet/sing-box → …);
// основной код пакета inst от этого файла НЕ зависит (Runner-интерфейс).
//
// Сборка с раннером: go build -tags singbox_run (плюс теги with_gvisor,
// with_quic, … — по целевой платформе, см. core-port-plan §2).
//
// LNB-18: никакие секреты не передаются через argv/env — конфиг целиком
// уходит в box.New через память (JSON собирает cfgbuild в этом же процессе).
package inst

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	box "github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/option"
)

// SingBoxRunner — запуск форка sing-box в текущем процессе (одновременно —
// один инстанс; менеджер гарантирует сериализацию, дубль — защита).
type SingBoxRunner struct {
	mu       sync.Mutex
	instance *box.Box
	// shutdownCh — канал graceful-лестницы: Close может занять время
	// (TUN/маршруты/QUIC-соединения); ждём его здесь же в Stop.
	shutdownCh chan struct{}
	// closing — Close уже идёт (I3): новый Start запрещён, пока инстанс не
	// освободит ресурсы.
	closing bool
}

// NewSingBoxRunner создаёт раннер (инстанс создаётся в Start).
func NewSingBoxRunner() *SingBoxRunner { return &SingBoxRunner{} }

// Start поднимает box.Box из конфига и ждёт готовности (box.Box.Start
// возвращает после открытия inbounds/outbound'ов).
func (r *SingBoxRunner) Start(ctx context.Context, configJSON []byte) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.instance != nil {
		return fmt.Errorf("singbox: инстанс уже запущен")
	}
	var options option.Options
	if err := json.Unmarshal(configJSON, &options); err != nil {
		return fmt.Errorf("singbox: некорректный конфиг: %w", err)
	}
	// Рабочий каталог процесса — каталог данных (rule-set кэш, cache_file
	// с относительными путями); подставляет вызывающая сторона (serve).
	// box.New(box.Options{Context, Options}) — см. box.go форка: контекст
	// несёт реестр сервисов/инбаундов; JSON — option.Options.
	instance, err := box.New(box.Options{Context: ctx, Options: options})
	if err != nil {
		return fmt.Errorf("singbox: box.New: %w", err)
	}
	if err := instance.Start(); err != nil {
		// старт не удался — ресурсы инстанса закрываем сразу (TUN мог
		// подняться частично; AUDIT §7.1.2)
		_ = instance.Close()
		return fmt.Errorf("singbox: старт: %w", err)
	}
	r.instance = instance
	r.shutdownCh = make(chan struct{})
	return nil
}

// Stop — graceful-остановка: box.Close() (TUN/маршруты/инбаунды) с ожиданием
// в горутине; ctx дан менеджером (≤ StopTimeout). Дождаться Close ВАЖНО:
// выход из процесса до завершения Close оставляет висящий TUN (AUDIT §7.1.2).
func (r *SingBoxRunner) Stop(ctx context.Context) error {
	r.mu.Lock()
	instance := r.instance
	ch := r.shutdownCh
	if instance == nil {
		r.mu.Unlock()
		return nil // Stop после неудачного Start — no-op
	}
	// I3 (аудит round 2): instance НЕ обнуляется до успешного Close. Раньше
	// при таймауте дескриптор терялся навсегда (утечка TUN), а следующий
	// Start поднимал второй инстанс поверх неубитого.
	r.closing = true
	r.mu.Unlock()

	done := make(chan error, 1)
	go func() {
		done <- instance.Close()
	}()
	var err error
	select {
	case err = <-done:
	case <-ctx.Done():
		// Close продолжает дорывать ресурсы в фоне; instance остаётся в
		// r.instance, чтобы повторный Stop мог дождаться его завершения.
		r.mu.Lock()
		r.closing = false
		r.mu.Unlock()
		return fmt.Errorf("singbox: закрытие не уложилось в таймаут (%w); инстанс считается упавшим", ctx.Err())
	}

	r.mu.Lock()
	r.instance = nil
	r.shutdownCh = nil
	r.closing = false
	r.mu.Unlock()
	if ch != nil {
		close(ch)
	}
	if err != nil {
		return fmt.Errorf("singbox: закрытие: %w", err)
	}
	return nil
}

var _ Runner = (*SingBoxRunner)(nil)
