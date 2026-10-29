// SPDX-License-Identifier: GPL-3.0-only

// connection.ts — единая логика «подключить/отключить» для экрана
// «Подключение» и меню титлбара. Режимы независимы (NekoBox-паритет):
// TUN — туннель, системный прокси — дополнительный канал для приложений,
// оба могут быть включены одновременно.
import { create } from '@bufbuild/protobuf';
import type { CoreClients } from './core';
import { ConnectMode, SettingValueSchema } from '../gen/lavray_pb';
import { tunNeedsElevation } from './elevation';
import { requestTunDialog } from './tunRequest';
import type { Profile } from '../gen/lavray_pb';

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

/** Настройка ядра с запомненными режимами (формат NekoBox: список `tun`, `system_proxy`). */
const REMEMBER_MODES_KEY = 'remember.modes';

/** Режимы в виде списка настройки `remember.modes`. */
export function rememberedModes(modes: ModePreferences): string[] {
  return [...(modes.tunMode ? ['tun'] : []), ...(modes.sysProxy ? ['system_proxy'] : [])];
}

/** Обратное преобразование; пустой или непонятный список — «ничего не запомнено» (`null`). */
export function modesFromRemembered(items: readonly string[]): ModePreferences | null {
  const names = new Set(items.map((item) => item.trim()));
  const tunMode = names.has('tun') || names.has('vpn');
  const sysProxy = names.has('system_proxy') || names.has('proxy');
  return tunMode || sysProxy ? { sysProxy, tunMode } : null;
}

/**
 * Записать выбранные режимы в настройку ядра. localStorage окна живёт только в
 * профиле WebView; перезапуск от администратора (T-81) должен вернуть тот же
 * выбор, поэтому режимы дублируются в ядре. Ядро недоступно — выбор остаётся в
 * localStorage, ошибка не показывается.
 */
export async function rememberModes(core: CoreClients, modes: ModePreferences): Promise<void> {
  try {
    await core.settings.setSettings({
      values: {
        [REMEMBER_MODES_KEY]: create(SettingValueSchema, {
          value: { case: 'stringListValue', value: { items: rememberedModes(modes) } },
        }),
      },
    });
  } catch {
    /* ядро недоступно — режимы остались в localStorage */
  }
}

/**
 * Режимы из ядра, если в localStorage их ещё нет (другой профиль WebView после
 * перезапуска от администратора, очищенные данные). Найденное записывается в
 * localStorage. `null` — восстанавливать нечего или есть собственный выбор окна.
 */
export async function restoreModes(
  core: CoreClients,
  storage: Storage,
): Promise<ModePreferences | null> {
  try {
    if (storage.getItem(KEY) !== null) return null;
    const res = await core.settings.getSettings({ keys: [REMEMBER_MODES_KEY] });
    const value = res.values[REMEMBER_MODES_KEY]?.value;
    if (value?.case !== 'stringListValue') return null;
    const modes = modesFromRemembered(value.value.items);
    if (modes !== null) saveModes(storage, modes);
    return modes;
  } catch {
    return null;
  }
}

const SERVER_KEY = 'lavray.server';

/**
 * Сервер, выбранный пользователем для подключения (id профиля). `null` —
 * выбора не было или значение в хранилище испорчено. Хранится рядом с
 * режимами (`lavray.modes`): это настройка интерфейса, а не ядра —
 * `remember.id` ядра читает только headless-режим при `remember.enable`.
 */
export function loadSelectedProfileId(storage: Storage): bigint | null {
  try {
    const raw = storage.getItem(SERVER_KEY);
    return raw !== null && /^[1-9]\d{0,18}$/.test(raw) ? BigInt(raw) : null;
  } catch {
    return null;
  }
}

export function saveSelectedProfileId(storage: Storage, id: bigint): void {
  try {
    storage.setItem(SERVER_KEY, id.toString());
  } catch {
    /* приватный режим браузера — выбор не сохраняется */
  }
}

/** Сервер для подключения: выбранный пользователем, пока он есть в списке, иначе первый. */
export function chooseProfile<T extends { readonly id: bigint }>(
  profiles: readonly T[],
  selectedId: bigint | null,
): T | undefined {
  return profiles.find((p) => p.id === selectedId) ?? profiles[0];
}

/** Задержка сервера, мс; `null` — не измерялась (0) или сервер недоступен (<0). */
export function latencyMsOf(p: Profile): number | null {
  const ms = p.testResult?.latencyMs;
  return ms !== undefined && ms > 0 ? ms : null;
}

/** Порядок меню выбора: по возрастанию задержки, без замера — в конце, при равенстве — как в списке. */
export function sortByLatency(profiles: readonly Profile[]): Profile[] {
  return profiles
    .map((profile, index) => ({ profile, index, ms: latencyMsOf(profile) }))
    .sort((a, b) => {
      if (a.ms === b.ms) return a.index - b.index;
      if (a.ms === null) return 1;
      if (b.ms === null) return -1;
      return a.ms - b.ms;
    })
    .map((x) => x.profile);
}

/** Режим ядра: TUN приоритетнее, но системный прокси ставится отдельно. */
export function coreModeFor(modes: ModePreferences): ConnectMode {
  return modes.tunMode ? ConnectMode.TUN : ConnectMode.SYSTEM_PROXY;
}

// Фактическое состояние системного прокси: что оболочка применила по нашей
// команде set_system_proxy в этом окне. Нужно статус-бару — раньше чип
// «Системный прокси» горел по переключателю и подключению, даже если прокси
// ОС не ставился (веб-режим, сбой команды).
let sysProxyApplied = false;
const sysProxyListeners = new Set<() => void>();

function markSystemProxy(on: boolean): void {
  if (sysProxyApplied === on) return;
  sysProxyApplied = on;
  for (const fn of sysProxyListeners) fn();
}

export function isSystemProxyApplied(): boolean {
  return sysProxyApplied;
}

export function onSystemProxyChange(fn: () => void): () => void {
  sysProxyListeners.add(fn);
  return (): void => {
    sysProxyListeners.delete(fn);
  };
}

// Собственные изменения соединения (кнопка, меню, Ctrl+D, трей, смена режима):
// пока они идут, окно само расставляет системный прокси, и «следование за
// ядром» (proxyFollow.ts) в это не вмешивается — иначе set_system_proxy ушёл
// бы дважды.
let ownChanges = 0;

/** Идёт ли собственное подключение, отключение или перезапуск соединения. */
export function isOwnChangeBusy(): boolean {
  return ownChanges > 0;
}

/** Выполнить собственное изменение соединения; окно не дублирует его прокси. */
export async function trackOwnChange<T>(change: () => Promise<T>): Promise<T> {
  ownChanges += 1;
  try {
    return await change();
  } finally {
    ownChanges -= 1;
  }
}

/** Включить/снять системный прокси через оболочку (только нативное окно). */
export async function applySystemProxy(on: boolean, port: number): Promise<void> {
  if ((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === undefined) {
    if (on) throw new Error('mode.sys.nativeOnly');
    markSystemProxy(false);
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  // Порт валидируется: u16 в Rust отвергает >65535 сырой ошибкой
  // десериализации, которую пользователю показывать бессмысленно.
  const safePort = Math.min(65535, Math.max(1, Math.trunc(port)));
  await invoke('set_system_proxy', { enabled: on, port: safePort });
  markSystemProxy(on);
}

export interface ConnectArgs {
  readonly core: CoreClients;
  readonly profileId: bigint;
  readonly modes: ModePreferences;
  readonly port: number;
}

/** Подключение: ядро + системный прокси согласно выбранным режимам. */
export async function connectWith(args: ConnectArgs): Promise<void> {
  await trackOwnChange(async () => {
    await args.core.core.connect({ profileId: args.profileId, mode: coreModeFor(args.modes) });
    await applySystemProxy(args.modes.sysProxy, args.port);
  });
}

/**
 * Отключение: сначала ядро, затем снятие системного прокси.
 *
 * Прокси снимается в `finally`: если ядро уже упало, `disconnect` бросит,
 * но оставить ОС с прокси на мёртвый порт нельзя (FR-UI-259) — иначе
 * пользователь остаётся без интернета.
 */
export async function disconnectAll(core: CoreClients): Promise<void> {
  await trackOwnChange(async () => {
    try {
      await core.core.disconnect({});
    } finally {
      await applySystemProxy(false, 0);
    }
  });
}

/** Что запущено (или должно быть запущено): сервер и режимы. */
export interface RunTarget {
  readonly profileId: bigint;
  readonly modes: ModePreferences;
}

/**
 * Перезапуск соединения на другой сервер или режим ядра (TUN ↔ системный
 * прокси). Ядро не меняет их на лету: Connect при активном инстансе отвечает
 * failed_precondition, а RestartProfile сохраняет прежние профиль и режим —
 * поэтому Disconnect, затем Connect.
 *
 * Если новый запуск не удался, пробуем вернуть прежний; не получилось и это —
 * снимаем системный прокси: он смотрел бы на порт без слушателя. Ошибка
 * нового запуска пробрасывается вызывающему.
 */
export async function reconnect(args: {
  readonly core: CoreClients;
  readonly next: RunTarget;
  readonly prev: RunTarget;
}): Promise<void> {
  await trackOwnChange(async () => {
    try {
      await args.core.core.disconnect({});
    } catch (e) {
      await applySystemProxy(false, 0);
      throw e;
    }
    try {
      await args.core.core.connect({
        profileId: args.next.profileId,
        mode: coreModeFor(args.next.modes),
      });
    } catch (e) {
      try {
        await args.core.core.connect({
          profileId: args.prev.profileId,
          mode: coreModeFor(args.prev.modes),
        });
      } catch {
        await applySystemProxy(false, 0);
      }
      throw e;
    }
  });
}

/**
 * Переключение соединения из любого места (меню титлбара, Ctrl+D).
 * Подключает сервер, выбранный на экране «Подключение» (первый в списке —
 * только если выбора не было или сервер удалён). Возвращает `false`, если
 * подключать нечего — вызывающий решает, что показать (обычно переходит на
 * экран «Подключение»).
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
  // T-46/T-81: TUN без прав администратора не поднимется — не пытаемся. Окно
  // показывается (трей и Ctrl+D бывают при скрытом окне), экран «Подключение»
  // (туда переходит вызывающий) открывает диалог перезапуска от администратора.
  if (loadModes(window.localStorage).tunMode && (await tunNeedsElevation())) {
    requestTunDialog();
    return false;
  }
  const list = await args.core.profiles.listProfiles({});
  const chosen = chooseProfile(list.profiles, loadSelectedProfileId(window.localStorage));
  if (chosen === undefined) return false;
  await connectWith({
    core: args.core,
    profileId: chosen.id,
    modes: loadModes(window.localStorage),
    port: args.port,
  });
  return true;
}
