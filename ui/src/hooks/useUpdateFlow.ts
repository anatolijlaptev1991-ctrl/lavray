// SPDX-License-Identifier: GPL-3.0-only

// useUpdateFlow.ts — поток «проверить → скачать → установить» для экрана
// «Обновления» (T-75). Состояние держит чистый редьюсер; замок от двойных кликов
// и отмену даёт useStepRunner; сами шаги — lib/updates/runners.ts.
import { useCallback, useMemo, useReducer, useState } from 'react';
import type { Dispatch } from 'react';
import { flowReducer, initialFlowState } from '../lib/updates/flowReducer';
import { APPLY_IDLE_MS, DOWNLOAD_IDLE_MS, runCheck, runDownload, runInstall } from '../lib/updates/runners';
import type { Channel, FlowAction, FlowState } from '../lib/updates/types';
import { useCore } from './useCore';
import { useStepRunner } from './useStepRunner';

export { flowReducer, initialFlowState } from '../lib/updates/flowReducer';
export type { FlowAction, FlowState } from '../lib/updates/types';

export interface UpdateFlowOptions {
  /** Сколько можно молчать стриму загрузки (мс); для тестов. */
  readonly downloadIdleMs?: number;
  /** То же для повторной проверки перед установкой. */
  readonly applyIdleMs?: number;
}

export interface UpdateFlowApi {
  readonly state: FlowState;
  /** Время последней успешной проверки из ответа ядра (мс), 0 — не было. */
  readonly lastCheckedAtMs: number;
  readonly check: () => void;
  readonly download: () => void;
  readonly cancelDownload: () => void;
  readonly install: () => void;
  /** Пользователь согласился разорвать активную VPN-сессию ради установки. */
  readonly confirmSession: () => void;
  readonly declineSession: () => void;
  readonly dismiss: () => void;
  readonly channelChanged: () => void;
  readonly markNotConfigured: () => void;
}

/** Действия без побочных эффектов; ссылки стабильны (экран кладёт их в зависимости эффектов). */
function useSimpleActions(dispatch: Dispatch<FlowAction>): Pick<UpdateFlowApi, 'declineSession' | 'dismiss' | 'channelChanged' | 'markNotConfigured'> {
  return useMemo(() => {
    const make =
      (type: FlowAction['type']) =>
      (): void => {
        dispatch({ type } as FlowAction);
      };
    return {
      declineSession: make('sessionDeclined'),
      dismiss: make('dismiss'),
      channelChanged: make('channelChanged'),
      markNotConfigured: make('notConfigured'),
    };
  }, [dispatch]);
}

export function useUpdateFlow(channel: Channel, options: UpdateFlowOptions = {}): UpdateFlowApi {
  const core = useCore();
  const [state, dispatch] = useReducer(flowReducer, initialFlowState);
  const [lastCheckedAtMs, setLastChecked] = useState(0);
  const { accepts, run, cancel } = useStepRunner(state);
  const downloadIdle = options.downloadIdleMs ?? DOWNLOAD_IDLE_MS;
  const applyIdle = options.applyIdleMs ?? APPLY_IDLE_MS;

  const check = useCallback((): void => {
    if (accepts('checkStart') === null) return;
    dispatch({ type: 'checkStart' });
    run(async () => {
      const ms = await runCheck(core, channel, dispatch);
      if (ms !== null && ms > 0) setLastChecked(ms);
    });
  }, [accepts, run, core, channel]);

  const download = useCallback((): void => {
    const next = accepts('downloadStart');
    if (next?.kind !== 'downloading') return;
    dispatch({ type: 'downloadStart' });
    run((signal) => runDownload(core, next.update, dispatch, signal, downloadIdle));
  }, [accepts, run, core, downloadIdle]);

  const startInstall = useCallback(
    (confirmed: boolean): void => {
      const next = accepts('installStart');
      if (next?.kind !== 'installing') return;
      dispatch({ type: 'installStart' });
      run((signal) => runInstall(core, dispatch, { staged: next.staged, confirmed, signal, idleMs: applyIdle }));
    },
    [accepts, run, core, applyIdle],
  );

  const simple = useSimpleActions(dispatch);

  return {
    state,
    lastCheckedAtMs,
    check,
    download,
    cancelDownload: cancel,
    install: useCallback((): void => {
      startInstall(false);
    }, [startInstall]),
    confirmSession: useCallback((): void => {
      startInstall(true);
    }, [startInstall]),
    ...simple,
  };
}
