// SPDX-License-Identifier: GPL-3.0-only

// useUpdateState.ts — состояние подсистемы обновлений при открытии экрана
// (GetUpdateState, T-75): время последней успешной проверки, доступность отката
// (оболочка хранит прошлый установщик), цепочка доверия и признак «не настроено».
import { useEffect, useState } from 'react';
import { UpdateComponent } from '../gen/lavray_pb';
import type { ChainStateInfo } from '../gen/lavray_pb';
import { classifyCoreError } from '../lib/updates/errors';
import { useCore } from './useCore';

export interface RollbackInfo {
  /** Версия, на которую вернёмся; пусто, если ядро её не назвало. */
  readonly version: string;
}

export interface UpdateStateInfo {
  readonly lastCheckedAtMs: number;
  /** Откат доступен, только если оболочка хранит прошлый установщик. */
  readonly rollback: RollbackInfo | null;
  readonly chain: ChainStateInfo | null;
  /** В сборке нет корня доверия: проверять обновления нечем. */
  readonly notConfigured: boolean;
}

const EMPTY: UpdateStateInfo = { lastCheckedAtMs: 0, rollback: null, chain: null, notConfigured: false };

export function useUpdateState(): UpdateStateInfo {
  const core = useCore();
  const [info, setInfo] = useState<UpdateStateInfo>(EMPTY);

  useEffect(() => {
    const ac = new AbortController();
    void (async (): Promise<void> => {
      try {
        const res = await core.updates.getUpdateState({}, { signal: ac.signal });
        const app = res.components.find((c) => c.component === UpdateComponent.APP);
        setInfo({
          lastCheckedAtMs: Number(res.lastCheckedAtMs),
          rollback: app?.rollbackAvailable === true ? { version: app.previousVersion ?? '' } : null,
          chain: res.chainState ?? null,
          notConfigured: false,
        });
      } catch (e) {
        if (ac.signal.aborted) return;
        // Другие ошибки (ядро занято, сеть) не мешают работе экрана: данных просто нет.
        if (classifyCoreError(e).kind === 'notConfigured') setInfo({ ...EMPTY, notConfigured: true });
      }
    })();
    return (): void => {
      ac.abort();
    };
  }, [core]);

  return info;
}
