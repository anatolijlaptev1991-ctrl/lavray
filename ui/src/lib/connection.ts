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

/** Включить/снять системный прокси через оболочку (только нативное окно). */
export async function applySystemProxy(on: boolean, port: number): Promise<void> {
  if ((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === undefined) {
    if (on) throw new Error('mode.sys.nativeOnly');
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  // Порт валидируется: u16 в Rust отвергает >65535 сырой ошибкой
  // десериализации, которую пользователю показывать бессмысленно.
  const safePort = Math.min(65535, Math.max(1, Math.trunc(port)));
  await invoke('set_system_proxy', { enabled: on, port: safePort });
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

/**
 * Отключение: сначала ядро, затем снятие системного прокси.
 *
 * Прокси снимается в `finally`: если ядро уже упало, `disconnect` бросит,
 * но оставить ОС с прокси на мёртвый порт нельзя (FR-UI-259) — иначе
 * пользователь остаётся без интернета.
 */
export async function disconnectAll(core: CoreClients): Promise<void> {
  try {
    await core.core.disconnect({});
  } finally {
    await applySystemProxy(false, 0);
  }
}

/**
 * Переключение соединения из любого места (меню титлбара, Ctrl+D).
 * Возвращает `false`, если подключать нечего — вызывающий решает, что
 * показать (обычно переходит на экран «Подключение»).
 */
export async function toggleConnection(args: {
  readonly core: CoreClients;
  readonly connected: boolean;
  readonly port: number;
}): Promise<boolean> {
  if (args.connected) {
    await disconnectAll(args.core);
    return true;
  }
  const list = await args.core.profiles.listProfiles({});
  const first = list.profiles[0];
  if (first === undefined) return false;
  await connectWith({
    core: args.core,
    profileId: first.id,
    modes: loadModes(window.localStorage),
    port: args.port,
  });
  return true;
}
