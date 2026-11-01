// SPDX-License-Identifier: GPL-3.0-only

// D-3: словари ru/zh/es/de грузятся лениво. Здесь проверяется подгрузка и
// регистрация (в остальных тестах test-setup.ts регистрирует все пять заранее).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deDict } from './dictionaries/de';
import { ruDict } from './dictionaries/ru';
import { DICTIONARIES, LANGUAGES, isDictionaryLoaded, registerDictionary } from './i18n';
import { applyLanguageWhenLoaded, loadLanguage } from './i18nLoad';

// Чанк словаря zh «не загружается» (обрыв сети).
vi.mock('./dictionaries/zh', () => {
  throw new Error('chunk load failed');
});

const originals = { ...DICTIONARIES };

afterEach(() => {
  for (const lang of LANGUAGES) registerDictionary(lang, originals[lang]);
});

describe('loadLanguage', () => {
  it('подгружает и регистрирует словарь ещё не загруженного языка', async () => {
    registerDictionary('de', {});
    expect(isDictionaryLoaded('de')).toBe(false);
    await loadLanguage('de');
    expect(isDictionaryLoaded('de')).toBe(true);
    expect(DICTIONARIES.de).toBe(deDict);
  });

  it('параллельные вызовы одного языка делят одну загрузку', async () => {
    registerDictionary('ru', {});
    const first = loadLanguage('ru');
    expect(loadLanguage('ru')).toBe(first);
    await first;
    expect(DICTIONARIES.ru).toBe(ruDict);
  });

  it('en и уже загруженный язык не требуют ожидания', async () => {
    expect(isDictionaryLoaded('en')).toBe(true);
    await expect(loadLanguage('en')).resolves.toBeUndefined();
    const before = DICTIONARIES.es;
    await loadLanguage('es');
    expect(DICTIONARIES.es).toBe(before);
  });

  it('отказ загрузки — исключение, и следующая попытка начинается заново', async () => {
    registerDictionary('zh', {});
    await expect(loadLanguage('zh')).rejects.toThrow();
    expect(isDictionaryLoaded('zh')).toBe(false);
    await expect(loadLanguage('zh')).rejects.toThrow();
  });
});

describe('applyLanguageWhenLoaded', () => {
  it('загруженный язык применяется сразу, синхронно', () => {
    const apply = vi.fn();
    applyLanguageWhenLoaded('es', apply);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('незагруженный язык применяется после загрузки словаря', async () => {
    registerDictionary('de', {});
    const apply = vi.fn(() => {
      expect(isDictionaryLoaded('de')).toBe(true);
    });
    applyLanguageWhenLoaded('de', apply);
    expect(apply).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(apply).toHaveBeenCalledTimes(1);
    });
  });

  it('словарь не загрузился — язык не меняется и ошибки не всплывают', async () => {
    registerDictionary('zh', {});
    const apply = vi.fn();
    applyLanguageWhenLoaded('zh', apply);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(apply).not.toHaveBeenCalled();
  });
});
