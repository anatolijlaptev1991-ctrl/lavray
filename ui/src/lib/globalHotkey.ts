// SPDX-License-Identifier: GPL-3.0-only

// globalHotkey.ts — глобальное сочетание «подключить / отключить» (T-82).
// Регистрирует оболочка (`hotkey_set`), она же проверяет правила и отвечает
// нормальной записью или кодом ошибки; нажатие приходит событием
// `hotkey-toggle-connect`. Пока открыт диалог захвата, события игнорируются:
// нажатие старого сочетания не должно подключать или отключать.
import type { MessageKey } from './i18n';

export const HOTKEY_EVENT = 'hotkey-toggle-connect';

/** Коды ошибок оболочки → текст. */
const ERROR_KEYS: Readonly<Record<string, MessageKey>> = {
  invalid_accel: 'hk.err.invalid',
  no_modifier: 'hk.err.noModifier',
  reserved: 'hk.err.reserved',
  conflict: 'hk.err.conflict',
};

/** Текст ошибки по коду; неизвестный код — общий текст. */
export function hotkeyErrorKey(code: string): MessageKey {
  return ERROR_KEYS[code] ?? 'hk.err.failed';
}

let suspended = false;

/** Приостановить реакцию на нажатия (диалог захвата открыт). */
export function suspendGlobalHotkey(on: boolean): void {
  suspended = on;
}

const inShell = (): boolean => (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;

/** Задать (`accel`) или снять (`null`) сочетание; ответ — нормальная запись. Ошибка — `Error(код)`. */
export async function setGlobalHotkey(accel: string | null): Promise<string | null> {
  if (!inShell()) throw new Error('unsupported');
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    const answer = await invoke<unknown>('hotkey_set', { accel });
    return typeof answer === 'string' ? answer : null;
  } catch (e) {
    throw new Error(typeof e === 'string' ? e : e instanceof Error ? e.message : 'failed');
  }
}

/** Подписаться на нажатия; возвращает отписку. Вне окна приложения — ничего. */
export async function listenGlobalHotkey(handler: () => void): Promise<() => void> {
  if (!inShell()) return (): void => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  return listen(HOTKEY_EVENT, () => {
    if (!suspended) handler();
  });
}

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;

/** Запись сочетания из нажатия (`Ctrl+Alt+K`); `null` — нажат только модификатор. */
export function accelFromKeyEvent(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  if (e.code === '' || MODIFIER_CODES.test(e.code)) return null;
  const letter = /^Key([A-Z])$/.exec(e.code);
  const digit = /^Digit([0-9])$/.exec(e.code);
  const key = letter?.[1] ?? digit?.[1] ?? e.code;
  const parts = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win'];
  return [...parts.filter((p): p is string => typeof p === 'string'), key].join('+');
}
