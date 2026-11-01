// SPDX-License-Identifier: GPL-3.0-only

// useUpdateData.ts — наборы маршрутов и гео-данные на экране «Обновления»
// (T-75/7.5): что нашла проверка, можно ли откатиться, ход «обновить» и «откатить».
// Одновременно идёт одно действие (ядро всё равно отвечает ABORTED на параллельное
// применение); уход с экрана обрывает стримы.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CheckUpdatesResponse } from '../gen/lavray_pb';
import type { MessageKey } from '../lib/i18n';
import { DATA_KINDS, dataOffers, dataRollbacks } from '../lib/updates/dataComponents';
import type { DataKind, DataOffer, DataRollback } from '../lib/updates/dataComponents';
import { installData, rollbackData } from '../lib/updates/dataRunners';
import type { DataResult } from '../lib/updates/dataRunners';
import { useCore } from './useCore';

/** Что сейчас с компонентом: простой, идёт действие, готово или ошибка. */
export type DataStep =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working'; readonly what: 'install' | 'rollback' }
  | { readonly kind: 'done'; readonly what: 'applied' | 'rolledBack'; readonly restart: boolean }
  | { readonly kind: 'error'; readonly key: MessageKey };

export interface DataRow {
  readonly kind: DataKind;
  /** Предложение из последней проверки; `null` — новых данных нет. */
  readonly offer: DataOffer | null;
  readonly rollback: DataRollback | null;
  readonly step: DataStep;
}

export interface UpdateDataApi {
  readonly rows: readonly DataRow[];
  /** Успешная проверка была: до неё «актуально» не говорится. */
  readonly checked: boolean;
  /** Идёт действие над любым из компонентов. */
  readonly busy: boolean;
  /** Ответ проверки: обновляет предложения. */
  readonly observeCheck: (res: CheckUpdatesResponse) => void;
  readonly install: (kind: DataKind) => void;
  readonly rollback: (kind: DataKind) => void;
}

type Steps = Readonly<Record<DataKind, DataStep>>;
const IDLE: Steps = { presets: { kind: 'idle' }, geo: { kind: 'idle' } };

function stepOf(r: DataResult): DataStep {
  switch (r.kind) {
    case 'applied':
      return { kind: 'done', what: 'applied', restart: r.restart };
    case 'rolledBack':
      return { kind: 'done', what: 'rolledBack', restart: r.restart };
    case 'failed':
      return { kind: 'error', key: r.key };
    case 'cancelled':
      return { kind: 'idle' };
  }
}

type Offers = Partial<Record<DataKind, DataOffer>>;

/** Предложения без компонента kind (его обновление применено). */
function without(offers: Offers, kind: DataKind): Offers {
  return Object.fromEntries(Object.entries(offers).filter(([k]) => k !== kind));
}

export function useUpdateData(): UpdateDataApi {
  const core = useCore();
  const [checked, setChecked] = useState(false);
  const [offers, setOffers] = useState<Offers>({});
  const [rollbacks, setRollbacks] = useState<Partial<Record<DataKind, DataRollback>>>({});
  const [steps, setSteps] = useState<Steps>(IDLE);
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await core.updates.getUpdateState({});
      setRollbacks(dataRollbacks(res.components));
    } catch {
      // Состояние отката не получено (ядро занято): кнопка отката просто не появится.
    }
  }, [core]);

  useEffect(() => {
    void refresh();
    return (): void => {
      abort.current?.abort();
    };
  }, [refresh]);

  const observeCheck = useCallback((res: CheckUpdatesResponse): void => {
    setChecked(true);
    setOffers(dataOffers(res));
  }, []);

  const act = useCallback(
    (kind: DataKind, what: 'install' | 'rollback'): void => {
      if (busy.current) return;
      busy.current = true;
      const ac = new AbortController();
      abort.current = ac;
      setSteps({ ...IDLE, [kind]: { kind: 'working', what } });
      void (async (): Promise<void> => {
        const result = await (what === 'install' ? installData(core, kind, ac.signal) : rollbackData(core, kind));
        busy.current = false;
        if (ac.signal.aborted) return;
        if (result.kind === 'applied') setOffers((o) => without(o, kind));
        setSteps({ ...IDLE, [kind]: stepOf(result) });
        await refresh();
      })();
    },
    [core, refresh],
  );

  const install = useCallback(
    (kind: DataKind): void => {
      act(kind, 'install');
    },
    [act],
  );
  const rollback = useCallback(
    (kind: DataKind): void => {
      act(kind, 'rollback');
    },
    [act],
  );
  const rows = DATA_KINDS.map((kind): DataRow => ({
    kind,
    offer: offers[kind] ?? null,
    rollback: rollbacks[kind] ?? null,
    step: steps[kind],
  }));
  return { rows, checked, busy: rows.some((r) => r.step.kind === 'working'), observeCheck, install, rollback };
}
