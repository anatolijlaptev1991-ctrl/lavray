// SPDX-License-Identifier: GPL-3.0-only

// importWarnings.ts — предупреждения предпросмотра импорта из ImportContentResponse.log.
// Ядро кладёт в журнал строки «код: текст»; текст ядра на русском, поэтому UI
// узнаёт код и подставляет свой перевод. Строки без известного кода не показываются:
// это обычный журнал импорта.
import type { MessageKey } from './i18n';

/** Код предупреждения → ключ словаря (подстановка {n} — сколько профилей затронуто). */
const WARNING_KEYS: Readonly<Record<string, MessageKey>> = {
  xhttp_unsupported: 'imp.warn.xhttp',
};

/** Предупреждения по одной фразе на код, с числом затронутых профилей. */
export function importLogWarnings(
  log: readonly string[],
  tf: (key: MessageKey, params: Readonly<Record<string, string | number>>) => string,
): string[] {
  const counts = new Map<string, number>();
  for (const line of log) {
    const code = /^([a-z0-9_]+):/.exec(line)?.[1];
    if (code !== undefined && code in WARNING_KEYS) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts].flatMap(([code, n]) => {
    const key = WARNING_KEYS[code];
    return key === undefined ? [] : [tf(key, { n })];
  });
}
