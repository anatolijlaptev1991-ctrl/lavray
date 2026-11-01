// SPDX-License-Identifier: GPL-3.0-only

/**
 * LAVRay i18n infrastructure (stage-3 scaffold).
 *
 * Mechanics mirror design/prototype.html (`I18N`, `t`, `tf`, `plural`,
 * `fmtBytes`, `LANG_NATIVE`, `LOCALES`); the full prototype dictionary is
 * migrated later (741 i18n_check keys in ru; 765 raw entries incl. plural
 * forms) — only the scaffold subset lives here. Translations are
 * copied verbatim from the prototype dictionaries.
 *
 * Rules (docs/DESIGN-SYSTEM.md §9, docs/I18N-GLOSSARY.md):
 * - the key set is identical across all five languages;
 * - units come from the dictionary (not Intl `style:'unit'`), with U+00A0
 *   between the number and the unit;
 * - numbers are formatted with Intl by locale.
 */

/** UI languages in the fixed prototype order (ru is the source language). */
export const LANGUAGES = ['ru', 'en', 'zh', 'es', 'de'] as const;

export type Language = (typeof LANGUAGES)[number];

/** Endonym for the language picker (DS §5: languages are named in themselves). */
export const LANG_NATIVE: Readonly<Record<Language, string>> = {
  ru: 'Русский',
  zh: '简体中文',
  en: 'English',
  es: 'Español',
  de: 'Deutsch',
};

/** Full BCP-47 locale per UI language (prototype `LOCALES`). */
export const LOCALES: Readonly<Record<Language, string>> = {
  ru: 'ru-RU',
  zh: 'zh-CN',
  en: 'en-US',
  es: 'es-ES',
  de: 'de-DE',
};

/** U+00A0 — non-breaking space between a number and its unit (glossary §1.4). */
export const NB = '\u00A0';

/** Reference dictionary: `en` defines the canonical key set (prototype mechanics fall back to en). */
// Полные словари перенесены дословно из прототипа v1.2 (машинная генерация):
// src/lib/dictionaries/<lang>.ts (765 ключей ru; en/zh/es/de — 747–753:
// различие только в plural-формах pl.* — ru имеет one/few/many, остальные one/other).
// D-3: словари живут в dictionaryRegistry.ts (в главном чанке только en).
import type { ruDict } from './dictionaries/ru';
import { DICTIONARIES } from './dictionaryRegistry';

export { DICTIONARIES, isDictionaryLoaded, registerDictionary } from './dictionaryRegistry';
export type { Dictionary } from './dictionaryRegistry';

/**
 * Полный набор ключей — по ru-словарю (самый полный: включает plural few/many).
 * ruDict намеренно объявлен БЕЗ аннотации `Record<string, string>`: с ней
 * `keyof` давал `string`, и компилятор не ловил несуществующие ключи (T-60).
 * Импорт типовой: словарь ru в главный чанк не попадает.
 */
export type MessageKey = keyof typeof ruDict;

/** Current language (module state; React subscribes via `onLanguageChange`). */
let current: Language = 'en';

const listeners = new Set<() => void>();

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** Pick the initial language from the environment (navigator.language), `en` fallback. */
export function detectLanguage(nav: readonly string[]): Language {
  for (const tag of nav) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return 'en';
}

/** localStorage key with the chosen language (written by useI18n.setLanguage). */
export const LANG_STORAGE_KEY = 'lavray.lang';

/**
 * Language at startup (T-37): `?lang=` (preview, never saved) → the choice
 * saved by the previous run → the system language (saved). Decides only,
 * applies nothing.
 */
export function resolveStartupLanguage(
  search: string,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  navigatorLanguages: readonly string[],
): Language {
  const forced = new URLSearchParams(search).get('lang');
  if (isLanguage(forced)) return forced;
  try {
    const saved = storage.getItem(LANG_STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    /* storage unavailable (private mode) — fall back to the system language */
  }
  const detected = detectLanguage(navigatorLanguages);
  try {
    storage.setItem(LANG_STORAGE_KEY, detected);
  } catch {
    /* the language just will not be remembered */
  }
  return detected;
}

/** Language chosen for this window at startup; applies nothing (main.tsx preloads its dictionary). */
export function startupLanguage(win: Window): Language {
  let storage: Pick<Storage, 'getItem' | 'setItem'>;
  try {
    storage = win.localStorage;
  } catch {
    storage = { getItem: (): null => null, setItem: (): void => undefined };
  }
  return resolveStartupLanguage(win.location.search, storage, win.navigator.languages);
}

/** Apply the startup language to the module state and to <html lang>; returns it. */
export function initLanguage(win: Window): Language {
  const lang = startupLanguage(win);
  setLanguage(lang);
  applyDocumentLanguage(win.document, lang);
  return lang;
}

export function getLanguage(): Language {
  return current;
}

/** Switch the language and notify subscribers (DS §9: no reload). */
export function setLanguage(lang: Language): void {
  if (!isLanguage(lang) || lang === current) return;
  current = lang;
  for (const fn of listeners) fn();
}

/** Subscribe to language changes; returns an unsubscribe function. */
export function onLanguageChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Active BCP-47 locale (for Intl). */
export function locale(lang: Language = current): string {
  return LOCALES[lang];
}

/** Translate a key in the current language; falls back to `en`, then to the key (prototype `t`). */
export function t(key: MessageKey, lang: Language = current): string {
  const dict = DICTIONARIES[lang];
  return dict[key] ?? DICTIONARIES.en[key] ?? key;
}

/**
 * Plural form по Intl.PluralRules: берёт ключ `<base>.<one|few|many|other>`.
 * Прототип использовал ручной выбор по числу; здесь — ICU-категории
 * (ru: one/few/many, en/zh/es/de: one/other).
 */
export function plural(base: string, n: number, lang: Language = current): string {
  const cat = new Intl.PluralRules(locale(lang)).select(n);
  const dict = DICTIONARIES[lang];
  const key = `${base}.${cat}`;
  const fallback = `${base}.other`;
  return dict[key] ?? dict[fallback] ?? DICTIONARIES.en[key] ?? DICTIONARIES.en[fallback] ?? base;
}

/** Plural + подстановка числа: `pl.p.one` → «1 профиль». */
export function pluralN(base: string, n: number, lang: Language = current): string {
  const s = plural(base, n, lang);
  return s.split('{n}').join(new Intl.NumberFormat(locale(lang)).format(n));
}

/** Translate with `{placeholder}` interpolation (prototype `tf`). */
export function tf(key: MessageKey, params: Readonly<Record<string, string | number>>, lang: Language = current): string {
  let s = t(key, lang);
  for (const [name, value] of Object.entries(params)) {
    s = s.split(`{${name}}`).join(String(value));
  }
  return s;
}

function numberFormat(lang: Language, maximumFractionDigits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits });
}

function formatNum(n: number, lang: Language, maximumFractionDigits: number): string {
  return numberFormat(lang, maximumFractionDigits).format(n);
}

const BYTE_UNITS: readonly (readonly [MessageKey, number])[] = [
  ['ub.gb', 1e9],
  ['ub.mb', 1e6],
  ['ub.kb', 1e3],
];

const SPEED_UNITS: readonly (readonly [MessageKey, number])[] = [
  ['u.gb', 1e9],
  ['u.mb', 1e6],
  ['u.kb', 1e3],
];

/** Volume in bytes → "1,2 МБ" (unit from the dictionary, NBSP, DS §9). Prototype `fmtBytes`. */
export function formatBytes(bytes: number, lang: Language = current): string {
  for (const [key, scale] of BYTE_UNITS) {
    if (bytes >= scale) return formatNum(bytes / scale, lang, 1) + NB + t(key, lang);
  }
  return formatNum(bytes, lang, 0) + NB + t('ub.b', lang);
}

/** Speed in bytes/s → "1,2 МБ/с". Prototype `fmtSpeed`. */
export function formatSpeed(bytesPerSec: number, lang: Language = current): string {
  if (!(bytesPerSec >= 1)) return formatNum(0, lang, 0) + NB + t('u.b', lang);
  for (const [key, scale] of SPEED_UNITS) {
    if (bytesPerSec >= scale) return formatNum(bytesPerSec / scale, lang, 1) + NB + t(key, lang);
  }
  return formatNum(bytesPerSec, lang, 0) + NB + t('u.b', lang);
}

/** Latency in ms → "43 мс". Prototype `fmtMs`. */
export function formatMs(ms: number | null, lang: Language = current): string {
  return ms === null ? '—' : formatNum(ms, lang, 0) + NB + t('unit.ms', lang);
}

/**
 * Duration in ms → clock form "h:mm:ss" / "m:ss" (prototype `connDur`),
 * with digits produced by Intl.NumberFormat for the active locale
 * (locale digit shaping applies).
 */
export function formatDuration(ms: number, lang: Language = current): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const two = new Intl.NumberFormat(locale(lang), { minimumIntegerDigits: 2, useGrouping: false });
  const mm = two.format(m);
  const ss = two.format(s);
  return h > 0 ? `${new Intl.NumberFormat(locale(lang)).format(h)}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Set `document.documentElement.lang` (zh → zh-CN), mirroring the prototype. */
export function applyDocumentLanguage(doc: Document, lang: Language = current): void {
  doc.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
}

/**
 * Relative time from an epoch-ms instant → "5 с назад" (прототип `relTime`).
 * Нужен карточкам утечек/здоровья: «Проверено: 5 с назад».
 */
export function formatSince(thenMs: number, lang: Language = current): string {
  const sec = Math.max(0, Math.floor((Date.now() - thenMs) / 1000));
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto' });
  if (sec < 60) return rtf.format(-sec, 'second');
  const min = Math.floor(sec / 60);
  if (min < 60) return rtf.format(-min, 'minute');
  const hours = Math.floor(min / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.floor(hours / 24), 'day');
}
