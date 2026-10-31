// SPDX-License-Identifier: GPL-3.0-only

// useTraffic.ts — скорость и итоги сессии из StatsService.Subscribe (T-79).
// Один источник для статус-бара (useTrafficSpeed) и графика (useTrafficStats):
// считают они одинаково (lib/traffic.ts), подписка снимается при размонтировании.
//
// Поток ядра живёт между сессиями: без соединения молчит, при остановке сессии
// шлёт финальный кадр (`final`) и ждёт следующую. Переподписываться ради этого
// не нужно; переподключение (lib/streamWatch.ts) — только при обрыве потока.
import { useEffect, useRef, useState } from 'react';
import { useCore } from './useCore';
import { useI18n } from './useI18n';
import { friendlyCoreError } from '../lib/core';
import { watchWithBackoff } from '../lib/streamWatch';
import { applySnapshot, EMPTY_READING, ZERO_SPEED } from '../lib/traffic';
import type { Speed, TrafficReading, TrafficTotals } from '../lib/traffic';

export type { Speed, TrafficTotals };

export interface TrafficStats extends TrafficReading {
  /** Текст ошибки потока для пользователя; пусто — всё в порядке. Пропадает с первым кадром. */
  readonly error: string;
}

/** Интервал кадров, как у графика (64 точки по секунде). */
const INTERVAL_MS = 1000;

/**
 * Скорость и итоги сессии. `onSample` зовётся на каждый кадр (и с нулями при
 * финальном кадре и обрыве) — график копит по нему точки.
 */
export function useTrafficStats(active: boolean, onSample?: (speed: Speed) => void): TrafficStats {
  const core = useCore();
  const { t } = useI18n();
  const [reading, setReading] = useState<TrafficReading>(EMPTY_READING);
  const [failure, setFailure] = useState<unknown>(null);
  const sampleRef = useRef(onSample);
  useEffect(() => {
    sampleRef.current = onSample;
  });

  useEffect(() => {
    let current = EMPTY_READING;
    const publish = (next: TrafficReading): void => {
      current = next;
      setReading(next);
      sampleRef.current?.(next.speed);
    };
    setReading(EMPTY_READING);
    setFailure(null);
    if (!active) return undefined;
    const ac = new AbortController();
    void watchWithBackoff(
      (signal) => core.stats.subscribe({ intervalMs: INTERVAL_MS }, { signal }),
      {
        onFrame: (snap) => {
          setFailure(null);
          publish(applySnapshot(current, snap));
        },
        // Связь потеряна: прежняя скорость уже не правда.
        onError: (e) => {
          setFailure(e);
          publish({ ...current, speed: ZERO_SPEED });
        },
      },
      ac.signal,
    );
    return (): void => {
      ac.abort();
    };
  }, [active, core]);

  const error = failure === null ? '' : friendlyCoreError(failure, t);
  return { ...reading, error };
}

/** Суммарная скорость для статус-бара. */
export function useTrafficSpeed(active: boolean): Speed {
  return useTrafficStats(active).speed;
}
