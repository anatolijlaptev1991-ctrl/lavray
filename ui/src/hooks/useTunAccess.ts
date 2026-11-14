// SPDX-License-Identifier: GPL-3.0-only

// useTunAccess.ts — состояние доступа ядра к сети для TUN на Linux (lib/tunAccess.ts):
// баннер и бейдж на экране «Подключение». Читается при показе, при возвращении
// фокуса окну (человек мог выдать права командой в терминале) и по `refresh()`.
// На Windows и в вебе — всегда `null`.
import { useCallback, useEffect, useState } from 'react';
import { readTunAccess, type TunAccessInfo } from '../lib/tunAccess';
import { useShellCaps } from './useShellCaps';

export interface TunAccessView {
  readonly access: TunAccessInfo | null;
  readonly refresh: () => void;
}

export function useTunAccess(): TunAccessView {
  const grant = useShellCaps().tunAccess === 'grant';
  const [access, setAccess] = useState<TunAccessInfo | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!grant) return undefined;
    let live = true;
    const reload = (): void => {
      void readTunAccess().then((next) => {
        if (live) setAccess(next);
      });
    };
    reload();
    window.addEventListener('focus', reload);
    return (): void => {
      live = false;
      window.removeEventListener('focus', reload);
    };
  }, [grant, nonce]);
  const refresh = useCallback((): void => {
    setNonce((n) => n + 1);
  }, []);
  return { access: grant ? access : null, refresh };
}
