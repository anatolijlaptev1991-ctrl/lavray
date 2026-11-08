// SPDX-License-Identifier: GPL-3.0-only

// useTraffic.ts — скорость и итоги сессии из StatsService.Subscribe (T-79).
// Один источник для статус-бара (useTrafficSpeed) и графика (useTrafficStats):
// считают они одинаково (lib/traffic.ts), подписка снимается при размонтировании.
//
// Поток ядра живёт между сессиями: без соединения молчит, при остановке сессии
// шлёт финальный кадр (`final`) и ждёт следующую. Переподписываться ради этого
// не нужно; переподключение (lib/streamWatch.ts) — только при обрыве потока.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useCore } from './useCore';
import { useI18n } from './useI18n';
import { friendlyCoreError } from '../lib/core';
import { EMPTY_READING } from '../lib/traffic';
import { trafficStore } from '../lib/trafficStore';
import type { Speed, TrafficReading, TrafficTotals } from '../lib/traffic';

export type { Speed, TrafficTotals };

export interface TrafficStats extends TrafficReading {
  /** Текст ошибки потока для пользователя; пусто — всё в порядке. Пропадает с первым кадром. */
  readonly error: string;
}

/**
 * Скорость и итоги сессии. `onSample` зовётся на каждый кадр (и с нулями при
 * обрыве) — график копит по нему точки. Поток общий для всех потребителей
 * (lib/trafficStore.ts): статус-бар и график видят одни и те же кадры.
 */
export function useTrafficStats(active: boolean, onSample?: (speed: Speed) => void): TrafficStats {
  const store = trafficStore(useCore());
  const { t } = useI18n();
  const sampleRef = useRef(onSample);
  useEffect(() => {
    sampleRef.current = onSample;
  });
  useEffect(() => {
    if (!active) return undefined;
    const stopSamples = store.onSample((s) => sampleRef.current?.(s));
    const release = store.acquire();
    return (): void => {
      stopSamples();
      release();
    };
  }, [active, store]);

  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { reading, failure } = active ? snap : { reading: EMPTY_READING, failure: null };
  const error = failure === null ? '' : friendlyCoreError(failure, t);
  return { ...reading, error };
}

/** Суммарная скорость для статус-бара. */
export function useTrafficSpeed(active: boolean): Speed {
  return useTrafficStats(active).speed;
}
