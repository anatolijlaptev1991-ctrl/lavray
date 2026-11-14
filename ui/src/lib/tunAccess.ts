// SPDX-License-Identifier: GPL-3.0-only

// tunAccess.ts — права для TUN на Linux (оболочка с `tunAccess: 'grant'`).
// Права там выдаются не процессу, а бинарю ядра (file capabilities), поэтому
// «админа» нет: оболочка отвечает командой `tun_access_state`, а выдачу
// разрешения (один запрос пароля системой) делает `tun_access_grant`.
// Команд может не быть (старая оболочка, веб): тогда доступ считается
// неизвестным и подключение не блокируется — ядро ответит само.

export type TunAccessKind = 'ready' | 'grantable' | 'manual' | 'unavailable' | 'elevate';

export interface TunAccessInfo {
  readonly state: TunAccessKind;
  /** '' | 'appimage' | 'nosuid' | … — почему нельзя выдать права. */
  readonly reason: string;
  /** Готовая команда для ручной выдачи (state `manual`). */
  readonly command: string;
  /** Права выданы уже после старта ядра: ядру нужен перезапуск. */
  readonly needsCoreRestart: boolean;
}

/** Что делать перед подключением в режиме TUN. */
export type TunGate =
  | { readonly kind: 'ready'; readonly restartCore: boolean }
  | { readonly kind: 'elevate' }
  | { readonly kind: 'grant' }
  | { readonly kind: 'manual'; readonly command: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

const KINDS: readonly TunAccessKind[] = ['ready', 'grantable', 'manual', 'unavailable', 'elevate'];

const inShell = (): boolean => (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;

/** Ответ `tun_access_state`; `null` — вне оболочки, команды нет или ответ неожиданного вида. */
export async function readTunAccess(): Promise<TunAccessInfo | null> {
  if (!inShell()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const r = await invoke<unknown>('tun_access_state');
    if (typeof r !== 'object' || r === null) return null;
    const o = r as Record<string, unknown>;
    if (typeof o.state !== 'string' || !(KINDS as readonly string[]).includes(o.state)) return null;
    return {
      state: o.state as TunAccessKind,
      reason: typeof o.reason === 'string' ? o.reason : '',
      command: typeof o.command === 'string' ? o.command : '',
      needsCoreRestart: o.needsCoreRestart === true,
    };
  } catch {
    return null;
  }
}

/** Состояние доступа → решение. `null` (не знаем) не блокирует подключение. */
export function gateFromAccess(info: TunAccessInfo | null): TunGate {
  if (info === null) return { kind: 'ready', restartCore: false };
  switch (info.state) {
    case 'ready':
      return { kind: 'ready', restartCore: info.needsCoreRestart };
    case 'grantable':
      return { kind: 'grant' };
    case 'manual':
      return { kind: 'manual', command: info.command };
    case 'unavailable':
      return { kind: 'unavailable', reason: info.reason };
    case 'elevate':
      return { kind: 'elevate' };
  }
}

/** Результат выдачи: `cancelled` — пользователь не ввёл пароль (не ошибка). */
export type GrantOutcome = 'granted' | 'cancelled';

/**
 * Выдать ядру разрешение управлять сетью. Ошибка — `Error` с кодом оболочки:
 * `not_grantable` либо `failed: <текст>`; `cancelled` — обычный ответ.
 */
export async function grantTunAccess(): Promise<GrantOutcome> {
  if (!inShell()) throw new Error('not_grantable');
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    await invoke<unknown>('tun_access_grant');
    return 'granted';
  } catch (e) {
    const code = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
    if (code === 'cancelled') return 'cancelled';
    throw new Error(code);
  }
}
