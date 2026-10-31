// SPDX-License-Identifier: GPL-3.0-only

// useShellBridge.ts — всё, что UI отдаёт оболочке и получает от неё по
// состоянию подключения: трей (T-45), системные уведомления и глобальное
// сочетание «подключить / отключить» (T-82).
import { useEffect, useRef } from 'react';
import { CoreState } from '../gen/lavray_pb';
import { listenGlobalHotkey } from '../lib/globalHotkey';
import { notifyKindFor, notifyText, showNotification, windowIsAway } from '../lib/notify';
import { readShellPrefs } from '../lib/shellPrefs';
import type { TrayAction, TrayStatusInput } from '../lib/tray';
import { useI18n } from './useI18n';
import { useTrayBridge } from './useTrayBridge';

/** Переходное состояние: глобальное сочетание в это время ничего не делает. */
export function isTransitional(state: CoreState): boolean {
  return state === CoreState.CONNECTING || state === CoreState.DISCONNECTING || state === CoreState.RECONNECTING;
}

/** Уведомление при смене состояния, только когда окно не на виду. */
export function useNotifications(state: CoreState): void {
  const { t } = useI18n();
  const prev = useRef<CoreState | null>(null);
  useEffect(() => {
    const kind = notifyKindFor(prev.current, state);
    prev.current = state;
    if (kind === null || !windowIsAway() || !readShellPrefs().notify) return;
    const { title, body } = notifyText(kind, t);
    void showNotification(kind, title, body);
  }, [state, t]);
}

/** Нажатие глобального сочетания → подключить или отключить (не во время перехода). */
export function useGlobalHotkey(state: CoreState, onToggle: () => void): void {
  const latest = useRef({ state, onToggle });
  latest.current = { state, onToggle };
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    listenGlobalHotkey(() => {
      if (!isTransitional(latest.current.state)) latest.current.onToggle();
    })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      })
      .catch(() => undefined);
    return (): void => {
      cancelled = true;
      stop?.();
    };
  }, []);
}

export function useShellBridge(
  status: TrayStatusInput,
  onTrayAction: (action: TrayAction) => void,
  onToggleConnect: () => void,
): void {
  useTrayBridge(status, onTrayAction);
  useNotifications(status.state);
  useGlobalHotkey(status.state, onToggleConnect);
}
