// SPDX-License-Identifier: GPL-3.0-only

// updates.dictionary.test.ts — L (T-75): каждый ключ `upd.*`, который используют
// исходники «Центра обновлений», есть во всех пяти словарях с настоящим текстом:
// не пустым, не равным самому ключу, не скопированным из русского; плейсхолдеры
// {name} совпадают с русским; слова «Happ» в видимых текстах нет.
import { describe, expect, it } from 'vitest';
import { DICTIONARIES, LANGUAGES, type Language } from '../../lib/i18n';

const sources = import.meta.glob<string>(
  [
    './*.tsx',
    '!./*.test.tsx',
    '../../hooks/useUpdate*.ts',
    '../../hooks/useLocalInstall.ts',
    '../../hooks/useRollback.ts',
    '../../lib/updates/*.ts',
    '!../../lib/updates/*.test.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
);

const KEY = /'(upd\.[A-Za-z0-9_.]+)'/g;
const PLURAL = /\bplural\(\s*'([^']+)'/g;

function scan(pattern: RegExp): Map<string, string> {
  const found = new Map<string, string>();
  for (const [file, text] of Object.entries(sources)) {
    for (const m of text.matchAll(pattern)) {
      const key = m[1];
      if (key !== undefined && !found.has(key)) found.set(key, file);
    }
  }
  return found;
}

const keys = scan(KEY);
const placeholders = (s: string): string[] => Array.from(s.matchAll(/\{(\w+)\}/g), (m) => m[1] ?? '').sort();
const dict = (lang: Language): Readonly<Record<string, string>> => DICTIONARIES[lang];

describe('ключи upd.* центра обновлений во всех пяти словарях', () => {
  it('проверка видит исходники и ключи (сам тест не пустой)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(15);
    expect(keys.size).toBeGreaterThan(40);
    for (const must of ['upd.mandatory', 'upd.uacCancelled', 'upd.notConfigured', 'upd.err.busy', 'upd.reason.expired']) {
      expect(keys.has(must), must).toBe(true);
    }
  });

  it('каждый ключ есть в ru, en, de, es, zh; текст не пуст и не равен ключу', () => {
    const problems: string[] = [];
    for (const [key, file] of keys) {
      for (const lang of LANGUAGES) {
        const value = dict(lang)[key];
        if (value === undefined || value.trim() === '' || value === key) problems.push(`${lang}: ${key} (${file})`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('en, de, es, zh не скопированы из русского (настоящие переводы)', () => {
    const copied: string[] = [];
    for (const key of keys.keys()) {
      for (const lang of ['en', 'de', 'es', 'zh'] as const) {
        if (dict(lang)[key] === dict('ru')[key]) copied.push(`${lang}: ${key}`);
      }
    }
    expect(copied).toEqual([]);
  });

  it('плейсхолдеры {name} совпадают с русским текстом', () => {
    const mismatched: string[] = [];
    for (const key of keys.keys()) {
      const base = placeholders(dict('ru')[key] ?? '');
      for (const lang of LANGUAGES) {
        if (placeholders(dict(lang)[key] ?? '').join() !== base.join()) mismatched.push(`${lang}: ${key}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('склонения pl.updDays: ru — one/few/many/other, en/de/es — one/other, zh — other', () => {
    expect(scan(PLURAL).has('pl.updDays')).toBe(true);
    const forms: Record<Language, readonly string[]> = {
      ru: ['one', 'few', 'many', 'other'],
      en: ['one', 'other'],
      de: ['one', 'other'],
      es: ['one', 'other'],
      zh: ['other'],
    };
    for (const lang of LANGUAGES) {
      for (const form of forms[lang]) {
        const value = dict(lang)[`pl.updDays.${form}`];
        expect(value, `${lang}.${form}`).toBeTruthy();
        expect(value, `${lang}.${form}`).toContain('{n}');
      }
    }
  });

  it('в словарях обновлений нет слова «Happ»', () => {
    const bad: string[] = [];
    for (const lang of LANGUAGES) {
      for (const [key, value] of Object.entries(dict(lang))) {
        if ((key.startsWith('upd.') || key.startsWith('pl.updDays')) && /happ/i.test(value)) bad.push(`${lang}: ${key}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('все ключи кодов оболочки и причин покрыты: upd.err.<код> и upd.reason.<причина>', () => {
    const codes = [
      'busy', 'path_outside_staging', 'sha256_mismatch', 'locked', 'core_stop_failed', 'launch_failed',
      'invalid_sha256', 'proxy_release_failed', 'prepare_failed', 'invalid_version', 'rollback_unavailable',
      'invalid_source', 'too_large', 'stage_failed',
    ];
    const reasons = [
      'bad_signature', 'expired', 'serial_rollback', 'wrong_product', 'wrong_channel', 'root_rotation',
      'artifact_role_missing', 'sha256_mismatch', 'truncated',
    ];
    for (const lang of LANGUAGES) {
      for (const code of codes) expect(dict(lang)[`upd.err.${code}`], `${lang} upd.err.${code}`).toBeTruthy();
      for (const reason of reasons) expect(dict(lang)[`upd.reason.${reason}`], `${lang} upd.reason.${reason}`).toBeTruthy();
    }
  });
});
