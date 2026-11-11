// SPDX-License-Identifier: GPL-3.0-only

// autostart.ts — автозапуск приложения с системой (T-82/Э-2). Состояние не
// хранится в настройках: оболочка читает его из ОС при каждом вызове
// (FR-UI-013). Windows: с правами администратора из установленной версии
// (Program Files) автозапуск — задача планировщика (приложение стартует
// повышенным, TUN работает сразу), иначе — значение `Run` в реестре. Linux:
// запись XDG в каталоге автозапуска сеанса. Другие ОС и веб-панель: строку
// скрываем.

/** Чем включён автозапуск. */
export type AutostartMethod = 'task' | 'registry' | 'desktop_entry';

/** Пояснение оболочки к результату изменения. */
export type AutostartNotice = 'task_needs_admin' | 'task_installed_only';

export interface AutostartInfo {
  readonly enabled: boolean;
  readonly method: AutostartMethod | null;
  /** Приложение сейчас с правами администратора. */
  readonly elevated: boolean;
  /** Приложение установлено (Program Files): только тогда допустима задача с правами. */
  readonly installed: boolean;
  /** Есть ли задача планировщика, узнать не удалось (ошибка планировщика, а не «не найдено»). */
  readonly unknown: boolean;
  /** Что не удалось довести до конца. */
  readonly notice: AutostartNotice | null;
}

function inShell(): boolean {
  return (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
}

/** Разбор ответа оболочки; `null` — автозапуск здесь не поддерживается. */
function parse(answer: unknown): AutostartInfo | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const a = answer as Record<string, unknown>;
  if (a.supported !== true) return null;
  return {
    enabled: a.enabled === true,
    method:
      a.method === 'task' || a.method === 'registry' || a.method === 'desktop_entry'
        ? a.method
        : null,
    elevated: a.elevated === true,
    installed: a.installed === true,
    unknown: a.unknown === true,
    notice: a.notice === 'task_needs_admin' || a.notice === 'task_installed_only' ? a.notice : null,
  };
}

/** Состояние автозапуска в ОС; `null` — нет оболочки, ОС не поддерживается или чтение не удалось. */
export async function readAutostart(): Promise<AutostartInfo | null> {
  if (!inShell()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return parse(await invoke<unknown>('autostart_state'));
  } catch {
    return null;
  }
}

/**
 * Включить или выключить автозапуск; возвращает состояние, заново прочитанное из
 * ОС. Ошибка оболочки (строка или `Error`) пробрасывается как `Error`.
 */
export async function writeAutostart(enabled: boolean): Promise<AutostartInfo> {
  if (!inShell()) throw new Error('unsupported');
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const info = parse(await invoke<unknown>('set_autostart', { enabled }));
    if (info === null) throw new Error('unsupported');
    return info;
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}
