// SPDX-License-Identifier: GPL-3.0-only

// no-client-confirmed.test.ts — T-08B: подтверждение custom-полей принадлежит ядру.
// Клиент не выставляет custom_fields_confirmed и не разрешает custom-поля при
// импорте (флаг allow_custom_fields удалён из proto): ни один исходник UI не
// должен содержать такой записи, иначе подтверждение снова обходится на клиенте.
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
  ['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./gen/**'],
  { query: '?raw', import: 'default', eager: true },
);

const FORBIDDEN: readonly RegExp[] = [/customFieldsConfirmed\s*:\s*true/, /allowCustomFields/];

describe('клиент не подтверждает custom-поля', () => {
  it('проверка видит исходники (сам тест не пустой)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(30);
  });

  it('в исходниках UI нет customFieldsConfirmed: true и allowCustomFields', () => {
    const offenders = Object.entries(sources).flatMap(([file, text]) =>
      FORBIDDEN.filter((re) => re.test(text)).map((re) => `${file}: ${String(re)}`),
    );
    expect(offenders).toEqual([]);
  });
});
