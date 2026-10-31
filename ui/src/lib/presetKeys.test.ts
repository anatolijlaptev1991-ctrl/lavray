// SPDX-License-Identifier: GPL-3.0-only

// presetKeys.test.ts — строки редактора наборов (T-80, L): ключи rt.*, toast.preset*
// и conns.rule* есть во всех 5 словарях, не пустые, с теми же подстановками
// {…}, что в русском; в видимых текстах нет «Happ».
import { describe, expect, it } from 'vitest';
import { DICTIONARIES, LANGUAGES } from './i18n';

const PREFIXES = ['rt.', 'toast.preset', 'conns.rule'] as const;
const ru = DICTIONARIES.ru;
const keys = Object.keys(ru).filter((k) => PREFIXES.some((p) => k.startsWith(p)));
const placeholders = (s: string): string => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(',');

describe('словари: наборы маршрутов', () => {
  it('находятся ключи rt.*, toast.preset* и conns.rule*', () => {
    expect(keys.length).toBeGreaterThan(60);
    for (const k of ['rt.menu', 'rt.resetSource', 'rt.proc.t', 'toast.presetConflict', 'toast.presetReset', 'conns.ruleCopy.t']) {
      expect(keys).toContain(k);
    }
  });

  it.each(LANGUAGES)('%s: каждый ключ есть, строка непустая и без «Happ»', (lang) => {
    const bad: string[] = [];
    for (const k of keys) {
      const v = DICTIONARIES[lang][k];
      if (typeof v !== 'string' || v.trim() === '' || /happ/i.test(v)) bad.push(k);
    }
    expect(bad).toEqual([]);
  });

  it.each(LANGUAGES)('%s: подстановки {name}/{n}/{rule} те же, что в ru', (lang) => {
    const bad = keys.filter((k) => placeholders(DICTIONARIES[lang][k] ?? '') !== placeholders(ru[k] ?? ''));
    expect(bad).toEqual([]);
  });

  it('toast.presetExported описывает сохранение в файл, а не копирование', () => {
    expect(ru['toast.presetExported']).not.toMatch(/скопирован/);
    expect(DICTIONARIES.en['toast.presetExported']).not.toMatch(/copied/);
  });
});
