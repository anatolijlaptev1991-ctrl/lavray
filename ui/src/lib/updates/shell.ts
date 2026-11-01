// SPDX-License-Identifier: GPL-3.0-only

// shell.ts — команды оболочки Tauri для обновлений (T-75): установка, откат,
// выбор установщика из файла, сигнал «приложение здорово». Установку выполняет
// оболочка, а не ядро; страница передаёт только пути и суммы, которые отдало ядро.
// Отказы оболочки — стабильные строки-коды (shell/src/update/error.rs).

/** Чем кончилась установка или откат без ошибки. */
export type ApplyOutcome = 'installing' | 'uac_cancelled';

/** Установщик, положенный оболочкой в staging. */
export interface StagedInstaller {
  readonly stagedPath: string;
  readonly sha256: string;
}

/** Отказ команды оболочки: `code` — стабильный код (`busy`, `locked`, …). */
export class ShellError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ShellError';
  }
}

/** Страница открыта в окне Tauri (в веб-панели команд оболочки нет). */
export function inShell(): boolean {
  return (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
}

function codeOf(e: unknown): string {
  if (typeof e === 'string') return e.trim();
  return e instanceof Error ? e.message.trim() : 'unknown';
}

async function call(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  if (!inShell()) throw new ShellError('no_shell');
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<unknown>(cmd, args);
  } catch (e) {
    throw new ShellError(codeOf(e));
  }
}

function asOutcome(reply: unknown): ApplyOutcome {
  const status = (reply as { status?: unknown } | null)?.status;
  if (status === 'installing' || status === 'uac_cancelled') return status;
  // Неизвестный ответ нельзя принимать за «установка началась».
  throw new ShellError('bad_reply');
}

export interface ApplyArgs {
  readonly stagedPath: string;
  readonly sha256: string;
  readonly version: string;
}

/** Установить проверенный ядром установщик (`update_apply`). */
export async function applyUpdate(args: ApplyArgs): Promise<ApplyOutcome> {
  return asOutcome(await call('update_apply', { stagedPath: args.stagedPath, sha256: args.sha256, version: args.version }));
}

/** Вернуть прошлую версию её установщиком (`update_rollback`). */
export async function rollbackUpdate(): Promise<ApplyOutcome> {
  return asOutcome(await call('update_rollback'));
}

/** «Установить из файла»: диалог выбора; `null` — пользователь отказался. */
export async function pickInstaller(): Promise<StagedInstaller | null> {
  const reply = await call('update_pick_installer');
  if (reply === null) return null;
  const { staged_path: stagedPath, sha256 } = (reply ?? {}) as { staged_path?: unknown; sha256?: unknown };
  if (typeof stagedPath !== 'string' || stagedPath === '' || typeof sha256 !== 'string' || sha256 === '') {
    throw new ShellError('bad_reply');
  }
  return { stagedPath, sha256 };
}

/** Сообщить оболочке: ядро готово и первый кадр нарисован (`update_health_ok`). */
export async function reportHealthOk(): Promise<void> {
  await call('update_health_ok');
}
