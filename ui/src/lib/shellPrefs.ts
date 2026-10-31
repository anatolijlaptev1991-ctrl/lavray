// SPDX-License-Identifier: GPL-3.0-only

// shellPrefs.ts — настройки оболочки (T-82): «Закрывать в трей», «Запускать
// свёрнутым», уведомления и глобальная горячая клавиша. Оболочка читает их из
// `ui-state.json` до создания окна (shell/src/prefs.rs), поэтому они живут не в
// ядре, а в общих ключах `localStorage`: uiState.ts отправляет каждое изменение
// в файл. Значения — "1"/"0"; сочетание клавиш — строка, пусто — выключено.

export const SHELL_PREF_KEYS = {
  closeToTray: 'lavray.closeToTray',
  startMinimized: 'lavray.startMinimized',
  notify: 'lavray.notify',
  hotkeyConnect: 'lavray.hotkeyConnect',
} as const;

export type ShellFlag = 'closeToTray' | 'startMinimized' | 'notify';

export interface ShellPrefs {
  readonly closeToTray: boolean;
  readonly startMinimized: boolean;
  readonly notify: boolean;
  readonly hotkeyConnect: string | null;
}

/** Умолчания — те же, что у оболочки (`ShellPrefs::default`). */
export const DEFAULT_SHELL_PREFS: ShellPrefs = {
  closeToTray: true,
  startMinimized: false,
  notify: true,
  hotkeyConnect: null,
};

function read(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function flag(raw: string | null, fallback: boolean): boolean {
  const v = raw?.trim();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return fallback;
}

/** Текущие настройки; нет значения или оно испорчено — умолчание, как у оболочки. */
export function readShellPrefs(storage: Storage = window.localStorage): ShellPrefs {
  const accel = read(storage, SHELL_PREF_KEYS.hotkeyConnect)?.trim() ?? '';
  return {
    closeToTray: flag(read(storage, SHELL_PREF_KEYS.closeToTray), DEFAULT_SHELL_PREFS.closeToTray),
    startMinimized: flag(read(storage, SHELL_PREF_KEYS.startMinimized), DEFAULT_SHELL_PREFS.startMinimized),
    notify: flag(read(storage, SHELL_PREF_KEYS.notify), DEFAULT_SHELL_PREFS.notify),
    hotkeyConnect: accel === '' ? null : accel,
  };
}

/** Записать флаг; `false`, если хранилище недоступно (приватный режим, квота). */
export function writeShellFlag(name: ShellFlag, value: boolean, storage: Storage = window.localStorage): boolean {
  try {
    storage.setItem(SHELL_PREF_KEYS[name], value ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** Записать сочетание (`null` — выключить); `false`, если хранилище недоступно. */
export function writeHotkeyConnect(accel: string | null, storage: Storage = window.localStorage): boolean {
  try {
    if (accel === null) storage.removeItem(SHELL_PREF_KEYS.hotkeyConnect);
    else storage.setItem(SHELL_PREF_KEYS.hotkeyConnect, accel);
    return true;
  } catch {
    return false;
  }
}
