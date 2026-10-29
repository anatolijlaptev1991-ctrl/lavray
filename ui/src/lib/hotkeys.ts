// SPDX-License-Identifier: GPL-3.0-only

// hotkeys.ts — сочетания клавиш: какая клавиша нажата (в любой раскладке),
// подпись «Ctrl+K» / «⌘K» (прототип modKey/kbdLabel) и фокус поля после
// перехода на другой экран.
import type { Language } from './i18n';

/** Клавиша, которую печатает латинская раскладка: буква, цифра или запятая. */
const LATIN_KEY = /^[a-z0-9,]$/;

/**
 * Клавиша сочетания: латинская буква или цифра в нижнем регистре либо «,».
 * Если раскладка печатает латиницу (в том числе Dvorak), берётся то, что
 * напечатано. Если нет (ЙЦУКЕН, ивритская и др.: `key` = «л»), клавиша
 * определяется по физическому положению — `e.code` (`KeyK`, `Digit3`,
 * `Comma`). Раньше сравнивался только `e.key`, и Ctrl+K на русской раскладке
 * не срабатывал. События без `code` (синтетические) работают по `key`.
 * Пустая строка — клавиша не опознана (Shift, Control, F5 и т. п.).
 */
export function hotkeyOf(e: { readonly key: string; readonly code: string }): string {
  const printed = e.key.length === 1 ? e.key.toLowerCase() : '';
  if (LATIN_KEY.test(printed)) return printed;
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1];
  if (letter !== undefined) return letter.toLowerCase();
  const digit = (/^Digit([0-9])$/.exec(e.code) ?? /^Numpad([0-9])$/.exec(e.code))?.[1];
  if (digit !== undefined) return digit;
  if (e.code === 'Comma') return ',';
  return printed;
}

/** Модификатор сочетаний: ⌘ на macOS, «Strg» в немецком интерфейсе, иначе «Ctrl». */
export function modLabel(os: string, lang: Language): string {
  if (os === 'macos' || os === 'mac') return '⌘';
  return lang === 'de' ? 'Strg' : 'Ctrl';
}

/** Подпись сочетания для <kbd>: «⌘K» на macOS, «Ctrl+K» (de: «Strg+K») на остальных; Esc — без модификатора. */
export function kbdLabel(key: string, os: string, lang: Language): string {
  if (key === 'Esc') return 'Esc';
  const mod = modLabel(os, lang);
  return mod === '⌘' ? `⌘${key}` : `${mod}+${key}`;
}

/**
 * Поставить фокус на элемент, который появится после смены экрана: React
 * рисует новый экран на следующем тике, поэтому ищем элемент несколько раз.
 */
export function focusWhenReady(selector: string, select = false, attempts = 40, delayMs = 25): void {
  const attempt = (left: number): void => {
    const el = document.querySelector<HTMLInputElement>(selector);
    if (el !== null) {
      el.focus();
      if (select) el.select();
      return;
    }
    if (left > 0) {
      window.setTimeout(() => {
        attempt(left - 1);
      }, delayMs);
    }
  };
  attempt(attempts);
}
