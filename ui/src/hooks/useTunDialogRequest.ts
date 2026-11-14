// SPDX-License-Identifier: GPL-3.0-only

// useTunDialogRequest.ts — «Подключить» из трея и Ctrl+D в режиме TUN без прав просят
// диалог, пока экран «Подключение» мог быть не открыт (lib/tunRequest.ts, T-81):
// просьба ждёт монтирования. Windows: диалог администратора. Linux: решение по
// состоянию доступа ядра; права уже есть — подключаем.
import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { onTunDialogRequest, takeTunDialogRequest } from '../lib/tunRequest';
import { useShellCaps } from './useShellCaps';
import type { TunActions, TunFlow } from './useTunFlow';

export function useTunDialogRequest(tunFlow: TunFlow, actions: MutableRefObject<TunActions>): void {
  const tunAccess = useShellCaps().tunAccess;
  useEffect(() => {
    const open = (): void => {
      if (!takeTunDialogRequest()) return;
      if (tunAccess === 'admin') {
        tunFlow.open({ kind: 'elevate' }, 'connect');
        return;
      }
      void tunFlow.guard('connect').then((ok) => {
        if (ok) actions.current.connect();
      });
    };
    open();
    return onTunDialogRequest(open);
  }, [tunFlow, tunAccess, actions]);
}
