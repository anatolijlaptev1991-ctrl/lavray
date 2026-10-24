import { beforeEach, describe, expect, it } from 'vitest';
import {
  DICTIONARIES,
  LANGUAGES,
  LANG_NATIVE,
  LOCALES,
  detectLanguage,
  formatBytes,
  formatDuration,
  formatMs,
  formatSpeed,
  getLanguage,
  isLanguage,
  onLanguageChange,
  setLanguage,
  t,
  tf,
} from './i18n';

describe('i18n dictionaries', () => {
  it('ships exactly five languages: ru, en, zh, es, de', () => {
    expect(LANGUAGES).toEqual(['ru', 'en', 'zh', 'es', 'de']);
    expect(Object.keys(DICTIONARIES).sort()).toEqual([...LANGUAGES].sort());
  });

  it('has the same non-plural key set in every language', () => {
    // Полные словари из прототипа: non-plural ключи идентичны; plural-формы
    // различны по языку (ru one/few/many, en/es/de one/other, zh other) —
    // как в design/tools/i18n_check.py и docs/fix-plan/03-i18n.md (F2).
    const nonPlural = (lang: string): string[] =>
      Object.keys(DICTIONARIES[lang as never])
        .filter((k) => !k.startsWith('pl.'))
        .sort();
    const reference = nonPlural('en');
    for (const lang of LANGUAGES) {
      expect(nonPlural(lang), `dictionary ${lang} (non-plural)`).toEqual(reference);
    }
  });

  it('has complete plural forms per language', () => {
    const expectForms = (lang: string, forms: readonly string[]): void => {
      const pluralKeys = Object.keys(DICTIONARIES[lang as never]).filter((k) =>
        k.startsWith('pl.'),
      );
      const bases = new Set(pluralKeys.map((k) => k.slice(0, k.lastIndexOf('.'))));
      for (const base of bases) {
        for (const form of forms) {
          expect(
            DICTIONARIES[lang as never][`${base}.${form}`],
            `${lang}: ${base}.${form}`,
          ).toBeTruthy();
        }
      }
    };
    expectForms('ru', ['one', 'few', 'many']);
    expectForms('en', ['one', 'other']);
    expectForms('es', ['one', 'other']);
    expectForms('de', ['one', 'other']);
    expectForms('zh', ['other']);
  });

  it('has no empty translations', () => {
    for (const lang of LANGUAGES) {
      for (const [key, value] of Object.entries(DICTIONARIES[lang])) {
        expect(value.length > 0, `${lang}.${key}`).toBe(true);
      }
    }
  });

  it('exposes a native name and locale for every language', () => {
    for (const lang of LANGUAGES) {
      expect(LANG_NATIVE[lang].length).toBeGreaterThan(0);
      expect(LOCALES[lang]).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });
});

describe('i18n t/tf', () => {
  beforeEach(() => {
    setLanguage('ru');
  });

  it('translates section names per language', () => {
    expect(t('nav.connection', 'ru')).toBe('Подключение');
    expect(t('nav.connection', 'en')).toBe('Connection');
    expect(t('nav.connection', 'zh')).toBe('连接');
    expect(t('nav.connection', 'es')).toBe('Conexión');
    expect(t('nav.connection', 'de')).toBe('Verbindung');
  });

  it('uses the current language when none is passed', () => {
    setLanguage('de');
    expect(t('conn.connect')).toBe('Verbinden');
    expect(getLanguage()).toBe('de');
  });

  it('interpolates {placeholders} in tf', () => {
    setLanguage('ru');
    expect(tf('toast.connected', { name: 'tokyo-1' })).toBe('Подключено · tokyo-1');
    expect(tf('toast.connected', { name: 'tokyo-1' }, 'en')).toBe('Connected · tokyo-1');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(tf('toast.connected', { other: 'x' }, 'en')).toBe('Connected · {name}');
  });
});

describe('i18n language switching', () => {
  it('rejects invalid values and notifies on change', () => {
    expect(isLanguage('ru')).toBe(true);
    expect(isLanguage('fr')).toBe(false);

    setLanguage('en');
    const seen: string[] = [];
    const unsubscribe = onLanguageChange(() => seen.push(getLanguage()));

    setLanguage('fr' as never); // invalid — ignored, no notification
    expect(seen).toEqual([]);

    setLanguage('zh');
    expect(seen).toEqual(['zh']);
    unsubscribe();

    setLanguage('ru'); // after unsubscribe — not recorded
    expect(seen).toEqual(['zh']);
  });

  it('detects the language from navigator tags with en fallback', () => {
    expect(detectLanguage(['ru-RU', 'en-US'])).toBe('ru');
    expect(detectLanguage(['de-DE', 'en'])).toBe('de');
    expect(detectLanguage(['es-ES'])).toBe('es');
    expect(detectLanguage(['fr-FR', 'ja-JP'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
  });
});

describe('i18n formatting (Intl by locale)', () => {
  it('formats bytes with dictionary units and U+00A0', () => {
    expect(formatBytes(0, 'ru')).toBe('0\u00A0Б');
    expect(formatBytes(512, 'ru')).toBe('512\u00A0Б');
    expect(formatBytes(1536, 'ru')).toBe('1,5\u00A0КБ');
    expect(formatBytes(2 * 1e9, 'en')).toBe('2\u00A0GB');
    expect(formatBytes(1.5e6, 'de')).toContain('\u00A0MB');
    // decimal separator follows the locale (ru uses comma)
    expect(formatBytes(1.5e6, 'ru')).toContain('1,5');
  });

  it('formats speed with /s units', () => {
    expect(formatSpeed(0, 'ru')).toBe('0\u00A0Б/с');
    expect(formatSpeed(1.2e6, 'ru')).toBe('1,2\u00A0МБ/с');
    expect(formatSpeed(1.2e6, 'en')).toBe('1.2\u00A0MB/s');
  });

  it('formats latency with the ms unit and an em dash for null', () => {
    expect(formatMs(43, 'ru')).toBe('43\u00A0мс');
    expect(formatMs(null, 'en')).toBe('—');
  });

  it('formats duration in clock form with locale digits', () => {
    expect(formatDuration(0, 'en')).toBe('00:00');
    expect(formatDuration(65_000, 'en')).toBe('01:05');
    expect(formatDuration(3_723_000, 'en')).toBe('1:02:03');
    expect(formatDuration(-5_000, 'en')).toBe('00:00');
  });
});
