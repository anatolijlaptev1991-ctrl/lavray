// connection.ts — единая логика «подключить/отключить» для экрана
// «Подключение» и меню титлбара. Режимы независимы (NekoBox-паритет):
// TUN — туннель, системный прокси — дополнительный канал для приложений,
// оба могут быть включены одновременно.
import type { CoreClients } from './core';
import { ConnectMode } from '../gen/lavray_pb';

export interface ModePreferences {
  readonly sysProxy: boolean;
  readonly tunMode: boolean;
}

const KEY = 'lavray.modes';

export function loadModes(storage: Storage): ModePreferences {
  try {
    const raw = storage.getItem(KEY);
    if (raw === null) return { sysProxy: true, tunMode: false };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { sysProxy: true, tunMode: false };
    const p = parsed as { sysProxy?: unknown; tunMode?: unknown };
    return {
      sysProxy: typeof p.sysProxy === 'boolean' ? p.sysProxy : true,
      tunMode: typeof p.tunMode === 'boolean' ? p.tunMode : false,
    };
  } catch {
    return { sysProxy: true, tunMode: false };
  }
}

export function saveModes(storage: Storage, modes: ModePreferences): void {
  try {
    storage.setItem(KEY, JSON.stringify(modes));
  } catch {
    /* приватный режим браузера — настройки не сохраняются */
  }
}

/** Режим ядра: TUN приоритетнее, но системный прокси ставится отдельно. */
export function coreModeFor(modes: ModePreferences): ConnectMode {
  return modes.tunMode ? ConnectMode.TUN : ConnectMode.SYSTEM_PROXY;
}

/** Включить системный прокси через оболочку (только нативное окно). */
export async function applySystemProxy(on: boolean, port: number): Promise<void> {
  if ((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === undefined) {
    if (on) throw new Error('mode.sys.nativeOnly');
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_system_proxy', { enabled: on, port: Math.max(0, port) });
}

export interface ConnectArgs {
  readonly core: CoreClients;
  readonly profileId: bigint;
  readonly modes: ModePreferences;
  readonly port: number;
}

/** Подключение: ядро + системный прокси согласно выбранным режимам. */
export async function connectWith(args: ConnectArgs): Promise<void> {
  await args.core.core.connect({ profileId: args.profileId, mode: coreModeFor(args.modes) });
  await applySystemProxy(args.modes.sysProxy, args.port);
}

/** Отключение: сначала ядро, затем снятие системного прокси. */
export async function disconnectAll(core: CoreClients): Promise<void> {
  await core.core.disconnect({});
  await applySystemProxy(false, 0);
}
