// SPDX-License-Identifier: GPL-3.0-only

// killSwitch.ts — kill switch системного прокси (хвосты B, 7.3). Настройка ядра
// `connect.kill_switch_proxy` — источник истины. Оболочка не говорит с ядром, поэтому
// интерфейс зеркалит значение в общий файл настроек UI (`ui-state.json`, ключ
// `lavray.killSwitchProxy`): оболочка читает его, когда ядро умирает, и при
// включённой настройке оставляет прокси (shell/src/killswitch.rs).
//
// Оставленный прокси — состояние, о котором нужно знать: приложения получают отказ,
// пока пользователь не нажмёт «Отключить» или не выйдет из приложения. Оболочка
// сообщает о нём событием `proxy-kept`; ниже — флаг этого состояния.

export const KILL_SWITCH_SETTING = 'connect.kill_switch_proxy';
export const KILL_SWITCH_KEY = 'lavray.killSwitchProxy';
export const PROXY_KEPT_EVENT = 'proxy-kept';

/** Записать зеркало для оболочки; `false`, если хранилище недоступно (приватный режим, квота). */
export function mirrorKillSwitch(on: boolean, storage: Storage = window.localStorage): boolean {
  try {
    storage.setItem(KILL_SWITCH_KEY, on ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** Настройка включена в значениях ядра (нет значения — умолчание «выключено»). */
export function killSwitchOn(values: Readonly<Record<string, string | boolean | number>>): boolean {
  return values[KILL_SWITCH_SETTING] === true;
}

const inShell = (): boolean => (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;

/** Подписаться на `proxy-kept`; возвращает отписку. Вне окна приложения — ничего. */
export async function listenProxyKept(handler: () => void): Promise<() => void> {
  if (!inShell()) return (): void => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  return listen(PROXY_KEPT_EVENT, () => {
    handler();
  });
}

/**
 * Спросить оболочку, оставлен ли системный прокси после падения ядра. Оболочка
 * ставит флаг раньше любого события, поэтому ответу можно верить, даже если
 * `proxy-kept` ещё не дошло или окно было перезагружено. Вне окна приложения и при
 * сбое команды — `false`.
 */
export async function queryProxyKept(): Promise<boolean> {
  if (!inShell()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke<unknown>('proxy_kept')) === true;
  } catch {
    return false;
  }
}

let kept = false;
const listeners = new Set<() => void>();

function setKept(next: boolean): void {
  if (kept === next) return;
  kept = next;
  for (const fn of listeners) fn();
}

/** Ядро умерло, прокси оставлен (событие оболочки). */
export function markProxyKept(): void {
  setKept(true);
}

/** Прокси снят или подключение восстановлено. */
export function clearProxyKept(): void {
  setKept(false);
}

export function isProxyKept(): boolean {
  return kept;
}

export function subscribeProxyKept(fn: () => void): () => void {
  listeners.add(fn);
  return (): void => {
    listeners.delete(fn);
  };
}
