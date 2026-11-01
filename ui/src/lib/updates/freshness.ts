// SPDX-License-Identifier: GPL-3.0-only

// freshness.ts — «свежесть» последней успешной проверки обновлений
// (UPDATE-SYSTEM §5.7, T-75): до первой проверки не показываем ничего,
// предупреждение — с 7-х полных суток, красный статус — с 30-х.

/** Через сколько полных суток без проверки показывается предупреждение. */
export const WARN_AFTER_DAYS = 7;
/** Через сколько полных суток без проверки статус становится красным. */
export const RED_AFTER_DAYS = 30;

const DAY_MS = 86_400_000;

export type FreshnessKind = 'never' | 'ok' | 'warn' | 'red';

export interface Freshness {
  readonly kind: FreshnessKind;
  /** Полных суток с последней проверки; для `never` — 0. */
  readonly days: number;
}

/**
 * Категория свежести по времени последней успешной проверки.
 * `lastCheckedAtMs` — как отдаёт ядро: 0 означает «успешных проверок не было».
 */
export function freshnessOf(lastCheckedAtMs: number, nowMs: number): Freshness {
  if (!Number.isFinite(lastCheckedAtMs) || lastCheckedAtMs <= 0) return { kind: 'never', days: 0 };
  // Время в будущем (сдвиг часов) считается «только что», а не отрицательными сутками.
  const days = Math.max(0, Math.floor((nowMs - lastCheckedAtMs) / DAY_MS));
  if (days >= RED_AFTER_DAYS) return { kind: 'red', days };
  if (days >= WARN_AFTER_DAYS) return { kind: 'warn', days };
  return { kind: 'ok', days };
}
