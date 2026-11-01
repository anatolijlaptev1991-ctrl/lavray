// SPDX-License-Identifier: GPL-3.0-only

// rootchain.go — ротация корня доверия N → N+1 → … до тех пор, пока источник
// не ответит 404 (но не больше MaxRootSteps шагов). Каждый шаг проверяется
// порогом ключей ПРЕДЫДУЩЕГО корня и ключами нового (Trust.VerifyRootUpdate);
// промежуточные корни могут быть просрочены, срок проверяется у итогового.
package updates

import (
	"context"
	"fmt"
	"time"
)

// MaxRootSteps — предел цепочки ротации за один запуск проверки.
const MaxRootSteps = 64

// RootName — имя файла корня версии v на источнике: «2.root.json».
func RootName(v int64) string { return fmt.Sprintf("%d.root.json", v) }

// AdvanceRoot тянет корни N+1, N+2, … с источников. Возвращает итоговое
// доверие и число принятых шагов. Источник отдал кандидата, но ни один не
// прошёл проверку, — ErrRootRotation (отзыв ключа нельзя обойти «пропуском»
// версии или подписью только старых ключей). Итоговый корень просрочен —
// ErrExpired (просроченный встроенный корень, у которого есть валидный
// преемник, не мешает).
func AdvanceRoot(ctx context.Context, srcs []Source, start *Trust, now time.Time) (*Trust, int, error) {
	cur, steps := start, 0
	for steps < MaxRootSteps {
		next, err := nextRoot(ctx, srcs, cur)
		if err != nil {
			return nil, steps, err
		}
		if next == nil {
			break
		}
		cur = next
		steps++
	}
	if exp := cur.Root().Expires; !now.Before(exp) {
		return nil, steps, fmt.Errorf("%w: root.json версии %d истёк (%s)", ErrExpired, cur.Root().Version, exp.UTC().Format(time.RFC3339))
	}
	return cur, steps, nil
}

// nextRoot — следующий корень или nil, если ни у одного источника его нет.
func nextRoot(ctx context.Context, srcs []Source, cur *Trust) (*Trust, error) {
	name := RootName(cur.Root().Version + 1)
	var rejected error
	for _, s := range srcs {
		raw, err := s.Fetch(ctx, name)
		if err != nil || len(raw) == 0 {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			continue // 404 или сеть: проверим остальные источники
		}
		next, verr := cur.VerifyRootUpdate(raw)
		if verr == nil {
			return next, nil
		}
		if rejected == nil {
			rejected = verr
		}
	}
	if rejected != nil {
		return nil, fmt.Errorf("%w: %v", ErrRootRotation, rejected)
	}
	return nil, nil
}
