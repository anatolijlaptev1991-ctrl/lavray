// SPDX-License-Identifier: GPL-3.0-only

// restartNeeded.ts — общий флаг «изменение применится после перезапуска ядра».
// Ответы ядра с `needs_profile_restart` (сохранение запущенного профиля, настройки,
// DNS, наборы правил) поднимают его из любого места; баннер `RestartNotice` один
// на приложение и не зависит от экрана, на котором внесена правка.

let needed = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (needed === next) return;
  needed = next;
  for (const fn of listeners) fn();
}

/** Ядро сообщило `needs_profile_restart`: показать баннер. */
export function markRestartNeeded(): void {
  set(true);
}

/** Ядро перезапущено или пользователь выбрал «Позже». */
export function clearRestartNeeded(): void {
  set(false);
}

export function getRestartNeeded(): boolean {
  return needed;
}

export function subscribeRestartNeeded(fn: () => void): () => void {
  listeners.add(fn);
  return (): void => {
    listeners.delete(fn);
  };
}
