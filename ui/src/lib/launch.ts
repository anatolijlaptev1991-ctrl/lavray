// SPDX-License-Identifier: GPL-3.0-only

// launch.ts — сведения оболочки о запуске (T-81). Признак «приложение только что
// перезапущено от администратора» даёт флаг командной строки
// `--elevated-relaunch` (команда оболочки `launch_info`), а не файл и не
// `localStorage`: у повышенного экземпляра свой профиль WebView.

let relaunched = false;
// Не сбрасывается: старт был перезапуском от администратора (для pendingConnect).
let relaunchedAtStart = false;

function inShell(): boolean {
  return (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
}

/**
 * Запросить у оболочки сведения о запуске. Вызывается до первого рендера; вне
 * оболочки и при сбое ничего не делает.
 */
export async function loadLaunchInfo(): Promise<void> {
  if (!inShell()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const answer = await invoke<unknown>('launch_info');
    relaunched =
      typeof answer === 'object' &&
      answer !== null &&
      (answer as { elevated_relaunch?: unknown }).elevated_relaunch === true;
    relaunchedAtStart = relaunched;
  } catch {
    /* оболочка без команды — подсказка после перезапуска не покажется */
  }
}

/** Приложение только что перезапущено от администратора: `true` один раз (для подсказки). */
export function takeRelaunched(): boolean {
  const was = relaunched;
  relaunched = false;
  return was;
}

/** Этот экземпляр запущен перезапуском от администратора (в отличие от `takeRelaunched` не сбрасывается). */
export function wasRelaunchedAtStart(): boolean {
  return relaunchedAtStart;
}
