// headless_test.go — цикл авторестарта: первый запуск, смерть, рестарт,
// выход по ctx; лимит попыток.
package headless

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeCore struct {
	connects   int
	aliveAfter int      // сколько секунд живёт после каждого connect (0 = сразу падает)
	failFirst  int      // первые N Connect ошибочны
	deadCh     chan int // сигнал «умер» из тикера waitForDeath — не нужен: alive() по времени
	connectsAt []time.Time
}

func (f *fakeCore) ConnectLast(ctx context.Context) error {
	f.connects++
	f.connectsAt = append(f.connectsAt, time.Now())
	if f.failFirst > 0 && f.connects <= f.failFirst {
		f.failFirst--
		return errors.New("start failed")
	}
	f.aliveAfter = 2 // секунды живёт
	return nil
}

func (f *fakeCore) StatusAlive() bool { return f.aliveAfter > 0 }

// ReduceAlive — тикер теста уменьшает жизнь.
func (f *fakeCore) ReduceAlive() {
	if f.aliveAfter > 0 {
		f.aliveAfter--
	}
}

func TestLoopReconnectsAfterCrash(t *testing.T) {
	core := &fakeCore{}
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		// Ждём два connect (первый + рестарт после смерти) и выходим.
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			if core.connects >= 2 {
				cancel()
				return
			}
			core.ReduceAlive() // «время идёт»
			time.Sleep(300 * time.Millisecond)
		}
		cancel()
	}()
	if err := Loop(ctx, core, Options{ReconnectDelay: 200 * time.Millisecond}); err != nil {
		t.Fatalf("loop: %v", err)
	}
	if core.connects < 2 {
		t.Fatalf("рестарта не было: connects=%d", core.connects)
	}
}

func TestLoopMaxAttempts(t *testing.T) {
	core := &fakeCore{failFirst: 99} // все попытки падают
	err := Loop(context.Background(), core, Options{ReconnectDelay: 10 * time.Millisecond, MaxAttempts: 3})
	if err == nil {
		t.Fatal("ожидали ошибку после исчерпания попыток")
	}
	if core.connects != 3 {
		t.Fatalf("connects=%d, want 3", core.connects)
	}
}

func TestLoopCtxExitDuringBackoff(t *testing.T) {
	core := &fakeCore{failFirst: 1}
	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(50 * time.Millisecond); cancel() }()
	if err := Loop(ctx, core, Options{ReconnectDelay: 5 * time.Second}); err != nil {
		t.Fatalf("loop: %v", err)
	}
}
