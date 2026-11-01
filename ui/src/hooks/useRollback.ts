// SPDX-License-Identifier: GPL-3.0-only

// useRollback.ts — откат на прошлую версию (T-75): команда оболочки
// `update_rollback` ставит сохранённый прошлый установщик. Ядро в откате не
// участвует (Rollback RPC для приложения отвечает «откат выполняет оболочка»).
import { useCallback, useRef, useState } from 'react';
import type { MessageKey } from '../lib/i18n';
import { shellErrorKey } from '../lib/updates/errors';
import { rollbackUpdate } from '../lib/updates/shell';

export type RollbackState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'installing' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'error'; readonly key: MessageKey };

export interface Rollback {
  readonly state: RollbackState;
  readonly run: () => void;
}

export function useRollback(): Rollback {
  const [state, setState] = useState<RollbackState>({ kind: 'idle' });
  const busy = useRef(false);

  const run = useCallback((): void => {
    if (busy.current) return;
    busy.current = true;
    setState({ kind: 'working' });
    void (async (): Promise<void> => {
      try {
        const outcome = await rollbackUpdate();
        setState({ kind: outcome === 'installing' ? 'installing' : 'cancelled' });
      } catch (e) {
        setState({ kind: 'error', key: shellErrorKey(e) });
      } finally {
        busy.current = false;
      }
    })();
  }, []);

  return { state, run };
}
