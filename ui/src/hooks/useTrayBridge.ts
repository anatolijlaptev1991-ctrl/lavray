// SPDX-License-Identifier: GPL-3.0-only

// useTrayBridge.ts — состояние подключения и строки меню → трей оболочки;
// выбор «Подключить»/«Отключить» в трее → действие UI (T-45).
import { useEffect, useMemo, useRef } from 'react';
import {
  buildTrayUpdate,
  listenTrayActions,
  pushTrayUpdate,
  type TrayAction,
  type TrayStatusInput,
} from '../lib/tray';
import { useI18n } from './useI18n';

export function useTrayBridge(status: TrayStatusInput, onAction: (action: TrayAction) => void): void {
  const { t, tf } = useI18n();
  const { state, activeProfileName } = status;

  // Новое сообщение — только при смене состояния, сервера или языка.
  const update = useMemo(
    () => buildTrayUpdate({ state, activeProfileName }, { t, tf }),
    [state, activeProfileName, t, tf],
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
