// SPDX-License-Identifier: GPL-3.0-only

package gateway

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// fakeRunner запоминает скрипты, которые получил бы `nft -f -`. nft в тестах
// не запускается.
type fakeRunner struct {
	scripts []string
	err     error
	block   bool // ждать ctx (проверка предела по времени)
}

func (f *fakeRunner) Run(ctx context.Context, script string) error {
	f.scripts = append(f.scripts, script)
	if f.block {
		<-ctx.Done()
		return ctx.Err()
	}
	return f.err
}

func TestNftApplierApplyAndRemove(t *testing.T) {
	r := &fakeRunner{}
	a := &NftApplier{Runner: r}
	script := NftRenderer{}.Render(baseCfg(), nil, "")
	if err := a.Apply(script); err != nil {
		t.Fatal(err)
	}
	if err := a.Remove(); err != nil {
		t.Fatal(err)
	}
	if len(r.scripts) != 2 || r.scripts[0] != script {
		t.Fatalf("Apply должен передать скрипт как есть: %d вызовов", len(r.scripts))
	}
	rm := r.scripts[1]
	if !strings.Contains(rm, "delete table inet lavray") || !strings.HasPrefix(rm, "table inet lavray\n") {
		t.Fatalf("скрипт снятия: %q", rm)
	}
}

func TestNftApplierPropagatesErrors(t *testing.T) {
	boom := errors.New("Error: syntax error")
	a := &NftApplier{Runner: &fakeRunner{err: boom}}
	if err := a.Apply("x"); !errors.Is(err, boom) {
		t.Fatalf("Apply: %v", err)
	}
	if err := a.Remove(); !errors.Is(err, boom) {
		t.Fatalf("Remove: %v", err)
	}
}

// TestNftApplierTimeout — зависший nft не блокирует шлюз навсегда (X).
func TestNftApplierTimeout(t *testing.T) {
	a := &NftApplier{Runner: &fakeRunner{block: true}, Timeout: 20 * time.Millisecond}
	start := time.Now()
	err := a.Apply("x")
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(start) > 2*time.Second {
		t.Fatalf("err=%v за %v", err, time.Since(start))
	}
}

// TestExecRunnerMissingBinary — отсутствие nft даёт ошибку, а не панику. Имя
// заведомо несуществующее: настоящий nft тест не запускает.
func TestExecRunnerMissingBinary(t *testing.T) {
	err := ExecRunner{Bin: "lavray-no-such-nft-binary"}.Run(context.Background(), "x")
	if err == nil || !strings.Contains(err.Error(), "nft:") {
		t.Fatalf("err=%v", err)
	}
}
