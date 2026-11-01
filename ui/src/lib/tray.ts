// SPDX-License-Identifier: GPL-3.0-only

// tray.ts — мост UI → трей оболочки (T-45). Оболочка не знает ни языка, ни
// состояния подключения: UI присылает состояние и готовые строки меню из
// словарей (команда `tray_update`, формат — `TrayUpdate` в shell/src/tray.rs),
// а выбор «Подключить»/«Отключить» приходит событием `tray-action`.
import { CoreState } from '../gen/lavray_pb';
import type { MessageKey } from './i18n';

/** Слова совпадают с `PlatformAdapter.setTrayState` и `TrayConn` оболочки. */
export type TrayConnState = 'off' | 'connecting' | 'on' | 'error';
export type TrayAction = 'connect' | 'disconnect';

export interface TrayUpdate {
  readonly state: TrayConnState;
  readonly labels: Readonly<
    Record<'status' | 'server' | 'connect' | 'disconnect' | 'show' | 'quit', string>
  >;
}

export interface TrayStatusInput {
  readonly state: CoreState;
  readonly activeProfileName?: string | undefined;
  /** Ядро умерло, kill switch оставил системный прокси: трей показывает ошибку, пока это так. */
  readonly proxyKept?: boolean | undefined;
}

export interface TrayTranslate {
  readonly t: (key: MessageKey) => string;
  readonly tf: (key: MessageKey, params: Readonly<Record<string, string | number>>) => string;
}

export function trayStateOf(state: CoreState): TrayConnState {
  switch (state) {
    case CoreState.CONNECTED:
      return 'on';
    case CoreState.CONNECTING:
    case CoreState.DISCONNECTING:
    case CoreState.RECONNECTING:
      return 'connecting';
    case CoreState.ERROR:
      return 'error';
    default:
      return 'off';
  }
}

const STATE_KEY: Readonly<Record<TrayConnState, MessageKey>> = {
  on: 'conn.state.on',
  connecting: 'conn.state.connecting',
  error: 'conn.state.err',
  off: 'conn.state.off',
};

/** Сообщение для `tray_update`: все строки — из словарей текущего языка. */
export function buildTrayUpdate(status: TrayStatusInput, { t, tf }: TrayTranslate): TrayUpdate {
  const kept = status.proxyKept === true;
  const state = kept ? 'error' : trayStateOf(status.state);
  const name = (status.activeProfileName ?? '').trim();
  return {
    state,
    labels: {
      status: `LAVRay — ${t(kept ? 'kill.tray' : STATE_KEY[state])}`,
      server: tf('tray.server', { name: name === '' ? '—' : name }),
      connect: t('conn.connect'),
      disconnect: t('conn.disconnect'),
      show: t('tray.show'),
      quit: t('menu.file.quit'),
    },
  };
}

const inTauri = (): boolean =>
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;

/** Отправить состояние в оболочку (вне окна Tauri — ничего не делает). */
export async function pushTrayUpdate(update: TrayUpdate): Promise<void> {
  if (!inTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('tray_update', { update });
}

/** Подписаться на выбор пунктов меню трея; возвращает отписку. */
export async function listenTrayActions(handler: (action: TrayAction) => void): Promise<() => void> {
  if (!inTauri()) return (): void => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  return listen<string>('tray-action', ({ payload }) => {
    if (payload === 'connect' || payload === 'disconnect') handler(payload);
  });
}
