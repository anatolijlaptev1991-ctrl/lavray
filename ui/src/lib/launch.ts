// SPDX-License-Identifier: GPL-3.0-only

// launch.ts — сведения оболочки о запуске и передача настроек окна при
// перезапуске от администратора (T-81). У повышенного экземпляра свой профиль
// WebView (общий с процессом другой целостности может не открыться), поэтому
// `localStorage` старого окна новому недоступен. Прежний экземпляр передаёт
// записи `lavray.*` оболочке (`save_ui_handoff`), новый получает их вместе с
// признаком перезапуска (`launch_info`) до первого рендера.

/** Ключи окна, которые переходят в новый профиль. */
const KEY_PREFIX = 'lavray.';

let relaunched = false;

function inShell(): boolean {
  return (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
}

/** Ответ `launch_info`: признак перезапуска и переданные записи; мусор даёт пустой результат. */
function parse(answer: unknown): { readonly relaunched: boolean; readonly handoff: [string, string][] } {
  if (typeof answer !== 'object' || answer === null) return { relaunched: false, handoff: [] };
  const a = answer as { elevated_relaunch?: unknown; handoff?: unknown };
  const handoff =
    typeof a.handoff === 'object' && a.handoff !== null
      ? Object.entries(a.handoff).filter(
          (entry): entry is [string, string] =>
            entry[0].startsWith(KEY_PREFIX) && typeof entry[1] === 'string',
        )
      : [];
  return { relaunched: a.elevated_relaunch === true, handoff };
}

/**
 * Запросить у оболочки сведения о запуске и применить переданные записи к
 * `storage`. Вызывается до первого рендера: язык, тема и режимы читаются уже из
 * них. Вне оболочки и при сбое ничего не делает.
 */
export async function applyLaunchInfo(storage: Storage): Promise<void> {
  if (!inShell()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const info = parse(await invoke<unknown>('launch_info'));
    for (const [key, value] of info.handoff) storage.setItem(key, value);
    relaunched = info.relaunched;
  } catch {
    /* оболочка без команды или хранилище закрыто — окно стартует со своими настройками */
  }
}

/** Приложение только что перезапущено от администратора: `true` один раз (для подсказки). */
export function takeRelaunched(): boolean {
  const was = relaunched;
  relaunched = false;
  return was;
}

/** Записи окна `lavray.*` для передачи. */
function collect(storage: Storage): Record<string, string> {
  const entries: Record<string, string> = {};
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    const value = key === null ? null : storage.getItem(key);
    if (key?.startsWith(KEY_PREFIX) === true && value !== null) entries[key] = value;
  }
  return entries;
}

/**
 * Передать записи окна оболочке перед перезапуском от администратора. Сбой не
 * мешает перезапуску: новое окно стартует со значениями по умолчанию, а режимы
 * подхватит из настройки ядра `remember.modes`.
 */
export async function sendHandoff(storage: Storage): Promise<void> {
  if (!inShell()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_ui_handoff', { entries: collect(storage) });
  } catch {
    /* см. выше */
  }
}
