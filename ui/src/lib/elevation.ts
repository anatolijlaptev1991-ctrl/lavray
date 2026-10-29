// SPDX-License-Identifier: GPL-3.0-only

// elevation.ts — права администратора для TUN (T-46, T-81). Оболочка отвечает
// командой `is_elevated`; повысить права она может только по явной просьбе
// пользователя — командой `relaunch_elevated` (перезапуск через UAC). Службы
// нет: TUN работает, когда приложение, а с ним и ядро, запущено от
// администратора (как в NekoBox).

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

/** Ответ команды `relaunch_elevated`: `started` — приложение сейчас закроется и откроется с правами. */
export type RelaunchOutcome = 'started' | 'cancelled';

/**
 * Перезапуск приложения от администратора (T-81). Диалог UAC показывает система:
 * отказ в нём — не ошибка, а ответ `cancelled`, и приложение остаётся как было.
 * Ошибка команды приходит строкой: `already_elevated`, `unsupported` (не Windows)
 * либо текст ОС.
 */
export async function relaunchElevated(): Promise<RelaunchOutcome> {
  if ((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === undefined) {
    throw new Error('unsupported');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const answer = await invoke<unknown>('relaunch_elevated');
  if (answer === 'started' || answer === 'cancelled') return answer;
  throw new Error('relaunch_elevated: неожиданный ответ');
}
