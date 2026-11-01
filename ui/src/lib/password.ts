// SPDX-License-Identifier: GPL-3.0-only

/**
 * Пароль резервной копии (T-83). Ядро получает пароль как UTF-8 и сравнивает
 * байты, а один и тот же текст бывает записан по-разному («é» одним символом
 * или буквой с accent-знаком), и копия, созданная на одной клавиатуре, не
 * открылась бы на другой. Поэтому перед отправкой пароль приводится к NFC.
 */

/** Не короче стольких символов (кодовых точек) — как в ядре. */
export const MIN_PASSWORD_CHARS = 8;
/** Не длиннее стольких байт UTF-8 — как в ядре. */
export const MAX_PASSWORD_BYTES = 1024;

export type PasswordIssue = 'short' | 'long';

/** Пароль в форме NFC: именно она уходит в ядро. */
export function normalizePassword(raw: string): string {
  return raw.normalize('NFC');
}

/** Проблема с длиной пароля после нормализации; null — пароль годится. */
export function passwordIssue(raw: string): PasswordIssue | null {
  const pw = normalizePassword(raw);
  if (new TextEncoder().encode(pw).length > MAX_PASSWORD_BYTES) return 'long';
  if (Array.from(pw).length < MIN_PASSWORD_CHARS) return 'short';
  return null;
}

/** Два ввода пароля одинаковы с точностью до формы нормализации Unicode. */
export function passwordsMatch(a: string, b: string): boolean {
  return normalizePassword(a) === normalizePassword(b);
}
