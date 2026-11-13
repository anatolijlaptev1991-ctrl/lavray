// SPDX-License-Identifier: GPL-3.0-only

// useConnections.ts — поток WatchConnections → состояние экрана «Соединения» (T-79).
//
// - Каждый кадр несёт ПОЛНЫЙ список активных; закрывшиеся (closedIds) уходят в
//   историю по последней известной копии (lib/conns/model.ts).
// - Пауза замораживает показ, поток продолжает работать: ничего не теряется.
// - Обрыв потока: ошибка для баннера и переподключение 1 с → 2 с → … → 30 с
//   (lib/streamWatch.ts); первый кадр снимает ошибку.
// - `active === false` (приложение не подключено): подписки нет, список и история
//   пусты; при отключении история сбрасывается. История живёт, пока открыт экран:
//   closedIds приходят только по подписке, а без неё полной картины всё равно нет.
// - Размонтирование обрывает запрос (abort).
// - Окно скрыто в трей: поток закрывается (список некому показывать), история
//   не сбрасывается; при показе подписка открывается заново, и модель сама
//   переносит исчезнувшие за это время соединения в историю (closedSince).
import { useCallback, useEffect, useReducer, useState } from 'react';
import { useCore } from './useCore';
import { useI18n } from './useI18n';
import { friendlyCoreError } from '../lib/core';
import { ACTIVE_PAGE_LIMIT, connsReducer, createState, viewOf } from '../lib/conns/model';
import type { ConnsModel } from '../lib/conns/model';
import { watchWithBackoff } from '../lib/streamWatch';
import { useWindowHidden } from './useWindowHidden';

const INTERVAL_MS = 1000;

export interface UseConnections {
  /** Что показывать: на паузе — снимок на момент паузы. */
  readonly view: ConnsModel;
  readonly paused: boolean;
  readonly setPaused: (paused: boolean) => void;
  /** Текст ошибки потока для баннера; пусто — всё в порядке. */
  readonly error: string;
}

export function useConnections(active: boolean): UseConnections {
  const core = useCore();
  const { t } = useI18n();
  const [state, dispatch] = useReducer(connsReducer, undefined, createState);
  const [failure, setFailure] = useState<unknown>(null);
  const hidden = useWindowHidden();

  // Сброс — только при смене «подключено» или ядра, но не при скрытии окна.
  useEffect(() => {
    dispatch({ type: 'reset' });
    setFailure(null);
  }, [active, core]);

  useEffect(() => {
    if (!active || hidden) return undefined;
    const ac = new AbortController();
    void watchWithBackoff(
      (signal) =>
        core.connections.watchConnections(
          { intervalMs: INTERVAL_MS, activePageLimit: ACTIVE_PAGE_LIMIT },
          { signal },
        ),
      {
        onFrame: (frame) => {
          setFailure(null);
          dispatch({ type: 'frame', frame, nowMs: Date.now() });
        },
        onError: setFailure,
      },
      ac.signal,
    );
    return (): void => {
      ac.abort();
    };
  }, [active, hidden, core]);

  const setPaused = useCallback((paused: boolean): void => {
    dispatch({ type: 'pause', paused });
  }, []);

  return {
    view: viewOf(state),
    paused: state.frozen !== null,
    setPaused,
    error: failure === null ? '' : friendlyCoreError(failure, t),
  };
}
