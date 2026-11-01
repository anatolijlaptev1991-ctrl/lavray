// SPDX-License-Identifier: GPL-3.0-only

// useNekoBoxDetect.ts — поиск установок NekoBox (T-78): один вызов
// MigrationService.DetectNekoBox при монтировании. Ядро только перечисляет
// каталоги и считает файлы; NekoBox оно не трогает. Сбой (ядро недоступно) —
// пустой список: ручной выбор папки остаётся.
import { useEffect, useState } from 'react';
import type { NekoBoxCandidate } from '../gen/lavray_pb';
import { useCore } from './useCore';

export interface NekoBoxDetect {
  readonly candidates: readonly NekoBoxCandidate[];
  /** Поиск ещё идёт. */
  readonly loading: boolean;
}

export function useNekoBoxDetect(): NekoBoxDetect {
  const core = useCore();
  const [state, setState] = useState<NekoBoxDetect>({ candidates: [], loading: true });

  useEffect(() => {
    const life = { alive: true };
    void (async (): Promise<void> => {
      let found: readonly NekoBoxCandidate[] = [];
      try {
        found = (await core.migration.detectNekoBox({})).candidates;
      } catch {
        /* ядро недоступно или поиск не удался — остаётся ручной выбор */
      }
      if (life.alive) setState({ candidates: found, loading: false });
    })();
    return (): void => {
      life.alive = false;
    };
  }, [core]);

  return state;
}
