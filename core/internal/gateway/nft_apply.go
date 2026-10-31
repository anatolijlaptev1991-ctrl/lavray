// SPDX-License-Identifier: GPL-3.0-only

package gateway

// nft_apply.go — применение и снятие правил через `nft -f -` (скрипт идёт в
// stdin). Сам запуск процесса спрятан за интерфейсом Runner: тесты подставляют
// фейк и nft не запускают. `nft -f` выполняет файл одной транзакцией, поэтому
// неудавшийся скрипт не оставляет половину правил, а прежний набор сохраняется.

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// removeScript снимает таблицу; первая строка создаёт её, если её нет, и
// повторное снятие не считается ошибкой.
const removeScript = "table inet lavray\ndelete table inet lavray\n"

// defaultNftTimeout — предел одного вызова nft.
const defaultNftTimeout = 15 * time.Second

// maxNftOutput — сколько байт вывода nft попадает в сообщение об ошибке.
const maxNftOutput = 512

// Runner выполняет nft-скрипт.
type Runner interface {
	Run(ctx context.Context, script string) error
}

// ExecRunner запускает настоящий `nft -f -`. Создаётся только в сборке для
// роутера (--platform openwrt).
type ExecRunner struct {
	Bin string // путь к nft; пусто — "nft" из PATH
}

// Run исполняет script; при ошибке в сообщение попадает начало вывода nft.
func (r ExecRunner) Run(ctx context.Context, script string) error {
	bin := r.Bin
	if bin == "" {
		bin = "nft"
	}
	cmd := exec.CommandContext(ctx, bin, "-f", "-")
	cmd.Stdin = strings.NewReader(script)
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(out.String())
		if len(msg) > maxNftOutput {
			msg = msg[:maxNftOutput] + "…"
		}
		return fmt.Errorf("nft: %w: %s", err, msg)
	}
	return nil
}

// NftApplier — Applier поверх Runner.
type NftApplier struct {
	Runner  Runner
	Timeout time.Duration // 0 — 15 с
}

func (a *NftApplier) run(script string) error {
	d := a.Timeout
	if d <= 0 {
		d = defaultNftTimeout
	}
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	return a.Runner.Run(ctx, script)
}

// Apply устанавливает набор правил (заменяя прежний целиком).
func (a *NftApplier) Apply(script string) error { return a.run(script) }

// Remove снимает таблицу inet lavray; интернет у LAN идёт напрямую.
func (a *NftApplier) Remove() error { return a.run(removeScript) }

var _ Applier = (*NftApplier)(nil)
