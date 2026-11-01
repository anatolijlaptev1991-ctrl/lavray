// SPDX-License-Identifier: GPL-3.0-only

// useStepRunner.ts — замок и отмена шагов «Центра обновлений» (T-75). Пока шаг
// (проверка, загрузка, установка) не закончился, второй не стартует: редьюсер
// обновляется асинхронно, и два клика в одном такте видели бы одно состояние.
// Уход с экрана обрывает шаг, который ещё идёт (стримы не остаются висеть).
import { useCallback, useEffect, useRef } from 'react';
import { flowReducer } from '../lib/updates/flowReducer';
import type { FlowAction, FlowState } from '../lib/updates/types';

export interface StepRunner {
  /** Состояние после действия, если шаг можно начинать (замок свободен и автомат принимает), иначе `null`. */
  readonly accepts: (type: FlowAction['type']) => FlowState | null;
  /** Запустить шаг под замком; замок снимается, когда он закончится. */
  readonly run: (task: (signal: AbortSignal) => Promise<void>) => void;
  /** Оборвать идущий шаг (кнопка «Отменить»). */
  readonly cancel: () => void;
}

export function useStepRunner(state: FlowState): StepRunner {
  const latest = useRef(state);
  latest.current = state;
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(
    () => (): void => {
      abort.current?.abort();
    },
    [],
  );

  const accepts = useCallback((type: FlowAction['type']): FlowState | null => {
    if (busy.current) return null;
    const next = flowReducer(latest.current, { type } as FlowAction);
    return next === latest.current ? null : next;
  }, []);

  const run = useCallback((task: (signal: AbortSignal) => Promise<void>): void => {
    busy.current = true;
    const ac = new AbortController();
    abort.current = ac;
    void task(ac.signal).finally(() => {
      busy.current = false;
      if (abort.current === ac) abort.current = null;
    });
  }, []);

  const cancel = useCallback((): void => {
    abort.current?.abort();
  }, []);

  return { accepts, run, cancel };
}
