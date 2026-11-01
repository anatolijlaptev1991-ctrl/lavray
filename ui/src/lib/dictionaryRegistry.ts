// SPDX-License-Identifier: GPL-3.0-only

// Реестр словарей интерфейса (D-3). Статически в главном чанке только en —
// язык-фолбэк `t()`; ru/zh/es/de подгружает i18nLoad.ts (динамический import,
// отдельный чанк на язык) и регистрирует здесь до первого рендера. В тестах все
// пять регистрирует test-setup.ts, поэтому `t()` там остаётся синхронным.
import type { Language } from './i18n';
import { enDict } from './dictionaries/en';

/** Словарь языка: все ключи этого языка; lookup с фолбеком en→key (см. t). */
export type Dictionary = Readonly<Record<string, string>>;

const NOT_LOADED: Dictionary = Object.freeze({});
const registry: Record<Language, Dictionary> = {
  ru: NOT_LOADED,
  en: enDict,
  zh: NOT_LOADED,
  es: NOT_LOADED,
  de: NOT_LOADED,
};

/** Словари по языкам; ещё не подгруженный язык пуст до `registerDictionary`. */
export const DICTIONARIES: Readonly<Record<Language, Dictionary>> = registry;

/** Зарегистрировать словарь языка. */
export function registerDictionary(lang: Language, dict: Dictionary): void {
  registry[lang] = dict;
}

/** Словарь языка уже зарегистрирован и не пуст. */
export function isDictionaryLoaded(lang: Language): boolean {
  return Object.keys(registry[lang]).length > 0;
}
