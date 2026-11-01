// SPDX-License-Identifier: GPL-3.0-only

// freshness.test.ts — «последняя проверка N дней назад» (UPDATE-SYSTEM §5.7, T-75):
// до первой успешной проверки не показываем ничего, предупреждение с 7-х суток,
// красный статус с 30-х. Границы 6/7/29/30 суток проверены точно.
import { describe, expect, it } from 'vitest';
import { freshnessOf } from './freshness';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
const ago = (days: number, extraMs = 0): number => NOW - days * DAY - extraMs;

describe('freshnessOf: last_checked_warn_7_red_30_hidden_before_first', () => {
  it('до первой проверки (0, отрицательное, NaN) — never, дней нет', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(freshnessOf(bad, NOW)).toEqual({ kind: 'never', days: 0 });
    }
  });

  it('только что и сегодня — ok, 0 суток', () => {
    expect(freshnessOf(NOW, NOW)).toEqual({ kind: 'ok', days: 0 });
    expect(freshnessOf(ago(0, 3 * 3_600_000), NOW)).toEqual({ kind: 'ok', days: 0 });
  });

  it.each([
    [1, 'ok'],
    [6, 'ok'],
    [7, 'warn'],
    [8, 'warn'],
    [29, 'warn'],
    [30, 'red'],
    [31, 'red'],
    [400, 'red'],
  ] as const)('%i сут. назад — %s (точные границы)', (days, kind) => {
    expect(freshnessOf(ago(days), NOW)).toEqual({ kind, days });
  });

  it('без одной минуты до границы ещё прошлая категория', () => {
    expect(freshnessOf(ago(7, -60_000), NOW)).toEqual({ kind: 'ok', days: 6 });
    expect(freshnessOf(ago(30, -60_000), NOW)).toEqual({ kind: 'warn', days: 29 });
  });

  it('время в будущем (сдвиг часов) не даёт отрицательных суток', () => {
    expect(freshnessOf(NOW + 5 * DAY, NOW)).toEqual({ kind: 'ok', days: 0 });
  });
});
