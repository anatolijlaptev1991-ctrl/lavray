// SPDX-License-Identifier: GPL-3.0-only

// platformText.test.ts — варианты текстов для Linux есть во всех пяти словарях и не
// содержат слов про администратора, UAC, Windows и `.exe`; слово из чёрного
// списка в новые тексты не попало.
import { describe, expect, it } from 'vitest';
import { DICTIONARIES, LANGUAGES } from './i18n';
import { PLATFORM_KEYS, platformKey } from './platformText';
import { getShellCaps } from './shellCaps';

const LINUX_KEYS = Object.keys(DICTIONARIES.ru).filter((k) => k.endsWith('.lx') || k.startsWith('tun.grant.'));
const WINDOWS_WORDS: Record<string, RegExp> = {
  ru: /администратор|UAC|Windows|\.exe|APPDATA|Roaming/i,
  en: /administrator|\badmin\b|UAC|Windows|\.exe|APPDATA|Roaming/i,
  de: /administrator|\badmin\b|UAC|Windows|\.exe|APPDATA|Roaming/i,
  es: /administrador|\badmin\b|UAC|Windows|\.exe|APPDATA|Roaming/i,
  zh: /管理员|UAC|Windows|\.exe|APPDATA|Roaming/i,
};

describe('варианты текстов для Linux', () => {
  it('каждый ключ из PLATFORM_KEYS имеет вариант .lx во всех языках', () => {
    for (const lang of LANGUAGES) {
      for (const key of PLATFORM_KEYS) {
        expect(DICTIONARIES[lang][`${key}.lx`], `${lang}: ${key}.lx`).toBeTypeOf('string');
        expect(DICTIONARIES[lang][key], `${lang}: ${key}`).toBeTypeOf('string');
      }
    }
  });

  it('тексты для Linux есть во всех словарях и не про администратора/Windows', () => {
    expect(LINUX_KEYS.length).toBeGreaterThan(20);
    for (const lang of LANGUAGES) {
      for (const key of LINUX_KEYS) {
        const text = DICTIONARIES[lang][key];
        expect(text, `${lang}: ${key}`).toBeTypeOf('string');
        expect(text, `${lang}: ${key}`).not.toMatch(WINDOWS_WORDS[lang] ?? /^$/);
      }
    }
  });

  it('слово Happ в новых текстах не встречается', () => {
    for (const lang of LANGUAGES) {
      for (const key of LINUX_KEYS) expect(DICTIONARIES[lang][key]).not.toMatch(/happ/i);
    }
  });

  it('platformKey: Windows и веб — прежний ключ, Linux — вариант .lx', () => {
    const web = getShellCaps();
    expect(platformKey('mode.tun.hint', web)).toBe('mode.tun.hint');
    expect(platformKey('mode.tun.hint', { ...web, os: 'windows' })).toBe('mode.tun.hint');
    expect(platformKey('mode.tun.hint', { ...web, os: 'linux' })).toBe('mode.tun.hint.lx');
  });
});
