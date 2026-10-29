// SPDX-License-Identifier: GPL-3.0-only

// i18n.keys.test.ts — T-60: MessageKey — union ключей словаря ru, а все
// статические ключи из исходников UI существуют в словарях всех языков.
import { describe, expect, it } from 'vitest';
import { DICTIONARIES, LANGUAGES, type MessageKey } from './i18n';

/** Исходники UI как текст: без тестов, сгенерированного кода и самих словарей. */
const sources = import.meta.glob<string>(
  ['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../gen/**', '!../lib/dictionaries/**'],
  { query: '?raw', import: 'default', eager: true },
);

/** Ключи, которые код передаёт строковым литералом. */
const STATIC_KEY_PATTERNS: readonly RegExp[] = [
  /\b(?:t|tf)\(\s*'([^']+)'/g, // t('ключ'), tf('ключ', {…})
  /\b(?:labelKey|titleKey|descKey|navKey|subKey|nameKey)\s*:\s*'([^']+)'/g, // таблицы строк
  /\blabel:\s*\{\s*key:\s*'([^']+)'/g, // вкладки: label: { key: '…' }
];
const PLURAL_PATTERN = /\bplural\(\s*'([^']+)'/g; // plural('pl.p', n)

function collect(patterns: readonly RegExp[]): Map<string, string> {
  const found = new Map<string, string>(); // ключ -> первый файл
  for (const [file, text] of Object.entries(sources)) {
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        const key = m[1];
        if (key !== undefined && !found.has(key)) found.set(key, file);
      }
    }
  }
  return found;
}

describe('MessageKey', () => {
  it('— union ключей словаря: несуществующий ключ ловит компилятор', () => {
    // Если MessageKey снова станет string, tsc сообщит «Unused '@ts-expect-error'
    // directive» именно на этой строке.
    // @ts-expect-error — 'no.such.key' не входит в MessageKey
    const bad: MessageKey = 'no.such.key';
    const good: MessageKey = 'common.save';
    expect(DICTIONARIES.ru[good]).toBeTypeOf('string');
    expect(DICTIONARIES.ru[bad]).toBeUndefined();
  });
});

describe('статические ключи из исходников', () => {
  it('регулярные выражения что-то находят (проверка самого теста)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(30);
    expect(collect(STATIC_KEY_PATTERNS).size).toBeGreaterThan(150);
    expect(collect([PLURAL_PATTERN]).has('pl.p')).toBe(true);
  });

  it('каждый ключ t()/tf()/labelKey/… есть в словарях всех 5 языков', () => {
    const missing: string[] = [];
    for (const [key, file] of collect(STATIC_KEY_PATTERNS)) {
      for (const lang of LANGUAGES) {
        if (DICTIONARIES[lang][key] === undefined) missing.push(`${lang}: ${key} (${file})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('у каждой базы plural(…) есть форма .other во всех языках и .one/.few/.many в ru', () => {
    const missing: string[] = [];
    for (const [base, file] of collect([PLURAL_PATTERN])) {
      for (const lang of LANGUAGES) {
        if (DICTIONARIES[lang][`${base}.other`] === undefined) missing.push(`${lang}: ${base}.other (${file})`);
      }
      for (const form of ['one', 'few', 'many']) {
        if (DICTIONARIES.ru[`${base}.${form}`] === undefined) missing.push(`ru: ${base}.${form} (${file})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('ключи, которые код берёт из таблиц-значений, существуют (web.title — подпись компонента WEBUI)', () => {
    for (const lang of LANGUAGES) {
      expect(DICTIONARIES[lang]['web.title'], lang).toBeTypeOf('string');
    }
  });
});
