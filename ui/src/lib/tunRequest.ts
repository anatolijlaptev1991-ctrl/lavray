// SPDX-License-Identifier: GPL-3.0-only

// tunRequest.ts — просьба «показать диалог перезапуска от администратора» от
// мест вне экрана «Подключение» (T-81): пункт «Подключить» в трее и Ctrl+D при
// выбранном TUN без прав. Окно в этот момент может быть скрыто в трей, а экран
// «Подключение» — не открыт: просьба запоминается и выполняется, когда экран
// смонтирован.

let pending = false;
const listeners = new Set<() => void>();

/** Показать главное окно оболочки (если оно скрыто в трей); вне оболочки ничего не делает. */
async function showWindow(): Promise<void> {
  if ((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === undefined) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('window_show');
  } catch {
    /* окно уже на экране или оболочка без команды */
  }
}

/** Попросить диалог TUN: показать окно и сообщить экрану «Подключение». */
export function requestTunDialog(): void {
  pending = true;
  void showWindow();
  for (const listener of listeners) listener();
}

/** Забрать просьбу; `true`, если она была. */
export function takeTunDialogRequest(): boolean {
  const was = pending;
  pending = false;
  return was;
}

/** Подписка экрана на новые просьбы. */
export function onTunDialogRequest(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}
