// SPDX-License-Identifier: GPL-3.0-only

// i18nLoad.ts — подгрузка словарей по требованию (D-3). В главном чанке только
// en; словарь выбранного языка грузится динамическим import ДО первого рендера
// (main.tsx), а при смене языка — до переключения. `t()` остаётся синхронным:
// он читает уже зарегистрированный словарь (dictionaryRegistry.ts).
import { isDictionaryLoaded, registerDictionary, type Dictionary, type Language } from './i18n';

type DictLoader = () => Promise<Dictionary>;

/** Загрузчики подгружаемых языков; en зарегистрирован статически. */
const LOADERS: Readonly<Record<Exclude<Language, 'en'>, DictLoader>> = {
  ru: () => import('./dictionaries/ru').then((m) => m.ruDict),
  zh: () => import('./dictionaries/zh').then((m) => m.zhDict),
  es: () => import('./dictionaries/es').then((m) => m.esDict),
  de: () => import('./dictionaries/de').then((m) => m.deDict),
};

/** Загрузки в полёте: параллельные вызовы одного языка делят один import. */
const inFlight = new Map<Language, Promise<void>>();

async function fetchDictionary(lang: Exclude<Language, 'en'>): Promise<void> {
  try {
    registerDictionary(lang, await LOADERS[lang]());
  } finally {
    inFlight.delete(lang); // при сбое следующая попытка начнёт заново
  }
}

/** Гарантирует, что словарь языка зарегистрирован; отказ сети — исключение. */
export function loadLanguage(lang: Language): Promise<void> {
  if (lang === 'en' || isDictionaryLoaded(lang)) return Promise.resolve();
  const pending = inFlight.get(lang) ?? fetchDictionary(lang);
  inFlight.set(lang, pending);
  return pending;
}

/**
 * Смена языка без перезагрузки (DS §9): `apply` вызывается, когда словарь уже
 * зарегистрирован — сразу, если он загружен, иначе после загрузки. Не
 * загрузился — `apply` не вызывается, язык остаётся прежним.
 */
export function applyLanguageWhenLoaded(lang: Language, apply: () => void): void {
  if (lang === 'en' || isDictionaryLoaded(lang)) {
    apply();
    return;
  }
  loadLanguage(lang).then(apply, () => undefined);
}
