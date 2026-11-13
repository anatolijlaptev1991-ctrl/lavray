// SPDX-License-Identifier: GPL-3.0-only

// useTrayBridge.ts — состояние подключения и строки меню → трей оболочки;
// выбор «Подключить»/«Отключить» в трее → действие UI (T-45).
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  buildTrayUpdate,
  listenTrayActions,
  pushTrayUpdate,
  type TrayAction,
  type TrayStatusInput,
} from '../lib/tray';
import { boostStatusPolling } from '../lib/coreStatusStore';
import { isProxyKept, subscribeProxyKept } from '../lib/killSwitch';
import { useI18n } from './useI18n';

export function useTrayBridge(status: TrayStatusInput, onAction: (action: TrayAction) => void): void {
  const { t, tf } = useI18n();
  const { state, activeProfileName } = status;
  // Kill switch: пока системный прокси оставлен, трей показывает ошибку при любой
  // смене состояния, сервера или языка, а не один раз при событии.
  const proxyKept = useSyncExternalStore(subscribeProxyKept, isProxyKept, isProxyKept);

  // Новое сообщение — только при смене состояния, сервера, языка или флага «оставлен».
  const update = useMemo(
    () => buildTrayUpdate({ state, activeProfileName, proxyKept }, { t, tf }),
    [state, activeProfileName, proxyKept, t, tf],
  );
  useEffect(() => {
    pushTrayUpdate(update).catch(() => undefined); // оболочка без трея — меню прежнее
  }, [update]);

  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    listenTrayActions((action) => {
      boostStatusPolling(); // окно скрыто: результат действия нужен без паузы скрытого опроса
      actionRef.current(action);
    })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return (): void => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
