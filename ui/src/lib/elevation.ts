// SPDX-License-Identifier: GPL-3.0-only

// elevation.ts — права администратора для TUN (T-46). Оболочка отвечает
// командой `is_elevated`; приложение само права не повышает (shell-lifecycle
// §7), поэтому UI может только объяснить, что делать.

/**
 * Запущена ли оболочка с повышенными правами. `null` — не знаем: веб-панель
 * (там нет оболочки) либо команда недоступна. Незнание не блокирует
 * подключение: ядро всё равно ответит само.
 */
export async function isElevated(): Promise<boolean | null> {
  if ((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === undefined) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const answer = await invoke<unknown>('is_elevated');
    return typeof answer === 'boolean' ? answer : null;
  } catch {
    return null;
  }
}

/** Режиму TUN не хватает прав: оболочка точно ответила «нет». */
export async function tunNeedsElevation(): Promise<boolean> {
  return (await isElevated()) === false;
}
