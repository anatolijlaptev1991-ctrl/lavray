// SPDX-License-Identifier: GPL-3.0-only

// pickFolder.ts — «Выбрать папку…» (T-78). В окне приложения папку выбирает
// пользователь в системном диалоге (команда оболочки `file_pick_folder`);
// страница получает только строку с путём. Вне окна приложения (веб-панель,
// тесты) диалога нет: путь вводят вручную, поэтому ответ — null.

const inShell = (): boolean => (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;

/** Путь выбранной папки; `null` — отмена или нет окна приложения. Сбой оболочки — `Error`. */
export async function pickFolder(): Promise<string | null> {
  if (!inShell()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    const path = await invoke<unknown>('file_pick_folder');
    return typeof path === 'string' && path !== '' ? path : null;
  } catch (e) {
    throw new Error(typeof e === 'string' ? e : e instanceof Error ? e.message : 'failed');
  }
}
