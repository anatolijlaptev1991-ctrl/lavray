// SPDX-License-Identifier: GPL-3.0-only

// trafficStore.ts — общий поток StatsService.Subscribe: одна подписка на ядро
// для статус-бара и графика (одни и те же кадры). Поток живёт, пока есть хотя
// бы один активный потребитель И окно на виду: скрытому в трей окну скорость
// показывать некому, поэтому поток закрывается (ядро и WebKitNetworkProcess
// перестают слать кадры раз в секунду) и открывается заново при показе.
// Обрыв переживается тем же watchWithBackoff.
import type { CoreClients } from './core';
import { watchWithBackoff } from './streamWatch';
import { applySnapshot, EMPTY_READING, ZERO_SPEED } from './traffic';
import { isWindowHidden, subscribeWindowHidden } from './windowVisibility';
import type { Speed, TrafficReading } from './traffic';

/** Интервал кадров, как у графика (64 точки по секунде). */
const INTERVAL_MS = 1000;

export interface TrafficSnapshot {
  readonly reading: TrafficReading;
  /** Последняя ошибка потока; null — всё в порядке (сбрасывается первым кадром). */
  readonly failure: unknown;
}

const EMPTY_SNAPSHOT: TrafficSnapshot = { reading: EMPTY_READING, failure: null };

export interface TrafficStore {
  /** Подписка на изменения снимка (для useSyncExternalStore). */
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => TrafficSnapshot;
  /** Подписка на каждый кадр (и на нулевой при обрыве) — график копит точки. */
  readonly onSample: (fn: (speed: Speed) => void) => () => void;
  /** Заявка на поток; возвращает отмену. Поток один, пока заявки есть. */
  readonly acquire: () => () => void;
}

function createStore(core: CoreClients): TrafficStore {
  const listeners = new Set<() => void>();
  const samplers = new Set<(speed: Speed) => void>();
  let snapshot = EMPTY_SNAPSHOT;
  let holders = 0;
  let abort: AbortController | undefined;
  let stopWatchingHidden: (() => void) | undefined;
  /** Поток закрыт ради скрытого окна: прежняя скорость по возвращении устарела. */
  let paused = false;

  const set = (next: TrafficSnapshot): void => {
    snapshot = next;
    listeners.forEach((l) => {
      l();
    });
  };
  const emit = (reading: TrafficReading, failure: unknown): void => {
    set({ reading, failure });
    samplers.forEach((fn) => {
      fn(reading.speed);
    });
  };
  const open = (): void => {
    // Показ после паузы: до первого кадра стрелки не должны показывать старую скорость.
    if (paused) set({ reading: { ...snapshot.reading, speed: ZERO_SPEED }, failure: null });
    paused = false;
    const ac = new AbortController();
    abort = ac;
    void watchWithBackoff(
      (signal) => core.stats.subscribe({ intervalMs: INTERVAL_MS }, { signal }),
      {
        onFrame: (snap) => {
          emit(applySnapshot(snapshot.reading, snap), null);
        },
        // Связь потеряна: прежняя скорость уже не правда.
        onError: (e) => {
          emit({ ...snapshot.reading, speed: ZERO_SPEED }, e);
        },
      },
      ac.signal,
    );
  };
  /** Привести поток в соответствие: он нужен, пока есть заявки и окно на виду. */
  const sync = (): void => {
    const wanted = holders > 0 && !isWindowHidden();
    if (wanted && abort === undefined) open();
    if (!wanted && abort !== undefined) {
      abort.abort();
      abort = undefined;
      paused = true;
    }
  };
  const release = (): void => {
    holders -= 1;
    if (holders > 0) return;
    stopWatchingHidden?.();
    stopWatchingHidden = undefined;
    sync();
    paused = false;
    set(EMPTY_SNAPSHOT);
  };

  return {
    subscribe: (l) => {
      listeners.add(l);
      return (): void => {
        listeners.delete(l);
      };
    },
    getSnapshot: () => snapshot,
    onSample: (fn) => {
      samplers.add(fn);
      return (): void => {
        samplers.delete(fn);
      };
    },
    acquire: () => {
      holders += 1;
      if (holders === 1) stopWatchingHidden = subscribeWindowHidden(sync);
      sync();
      let released = false;
      return (): void => {
        if (released) return;
        released = true;
        release();
      };
    },
  };
}

const stores = new WeakMap<CoreClients, TrafficStore>();

export function trafficStore(core: CoreClients): TrafficStore {
  let store = stores.get(core);
  if (store === undefined) {
    store = createStore(core);
    stores.set(core, store);
  }
  return store;
}
