// SPDX-License-Identifier: GPL-3.0-only

// coreStatusStore.ts — общий источник статуса ядра: один цикл опроса GetStatus
// на набор клиентов ядра, сколько бы компонентов ни подписалось (App, экраны).
//
// Следующий запрос уходит только после завершения предыдущего (медленный RPC
// не копит очередь); пока окно скрыто (lib/windowVisibility.ts), опрос не
// останавливается (от статуса зависят трей, системный прокси, kill switch и
// автоподключение), а лишь замедляется до STATUS_POLL_HIDDEN_MS; при показе —
// сразу запрос. Переходное состояние и недавнее действие пользователя
// (boostStatusPolling: трей, глобальное сочетание) опрашиваются в обычном темпе
// и в скрытом окне. Снимок заменяется только при изменении полей статуса, поэтому
// одинаковый ответ не вызывает рендера подписчиков.
import { create, equals } from '@bufbuild/protobuf';
import type { CoreClients } from './core';
import { friendlyCoreError } from './core';
import type { CoreStatus } from '../gen/lavray_pb';
import { CoreState, CoreStatusSchema } from '../gen/lavray_pb';
import { isWindowHidden, subscribeWindowHidden } from './windowVisibility';

/** Пауза между опросами, считается от завершения предыдущего запроса. */
export const STATUS_POLL_MS = 1000;
/** В скрытом окне (трей) опрос продолжается, но реже: от статуса зависят системный прокси, трей и уведомления. */
export const STATUS_POLL_HIDDEN_MS = 5000;
/** Сколько после действия из трея или сочетания клавиш опрос идёт в обычном темпе даже в скрытом окне. */
export const STATUS_BOOST_MS = 15_000;

export interface CoreStatusStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => CoreStatus;
  /** Опросить сейчас и держать обычный темп STATUS_BOOST_MS (действие пользователя в скрытом окне). */
  readonly boost: () => void;
}

const initialStatus = (): CoreStatus =>
  create(CoreStatusSchema, { state: CoreState.IDLE, activeProfileId: 0n, lastError: '' });

/** Работающие хранилища: boostStatusPolling будит их все (ядро в приложении одно, но клиенты пересоздаются). */
const running = new Set<CoreStatusStore>();

/** Действие пользователя вне видимого окна (трей, глобальное сочетание): ближайшие секунды статус нужен без задержки. */
export function boostStatusPolling(): void {
  running.forEach((store) => {
    store.boost();
  });
}

const isTransitional = (s: CoreState): boolean =>
  s === CoreState.CONNECTING || s === CoreState.DISCONNECTING || s === CoreState.RECONNECTING;

function createStore(core: CoreClients): CoreStatusStore {
  const listeners = new Set<() => void>();
  let snapshot = initialStatus();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let active = false;
  let boostUntil = 0;
  let stopWatchingHidden: (() => void) | undefined;

  const publish = (next: CoreStatus): void => {
    if (equals(CoreStatusSchema, snapshot, next)) return;
    snapshot = next;
    listeners.forEach((l) => {
      l();
    });
  };
  const schedule = (): void => {
    if (!active) return;
    const slow = isWindowHidden() && !isTransitional(snapshot.state) && Date.now() >= boostUntil;
    timer = setTimeout(() => {
      void tick();
    }, slow ? STATUS_POLL_HIDDEN_MS : STATUS_POLL_MS);
  };
  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      // Статус передаётся целиком: таймер сессии, режим, имя профиля, версия (D9/D15).
      publish(await core.core.getStatus({}));
    } catch (e) {
      publish(create(CoreStatusSchema, { ...snapshot, lastError: friendlyCoreError(e) }));
    } finally {
      inFlight = false;
      schedule();
    }
  }
  /** Опросить сейчас: таймер перезаводится; идущий запрос не дублируется (после него расписание сменится само). */
  const pollNow = (): void => {
    if (!active || inFlight) return;
    clearTimeout(timer);
    void tick();
  };
  const onVisibility = (): void => {
    if (!isWindowHidden()) pollNow();
  };
  const start = (): void => {
    active = true;
    stopWatchingHidden = subscribeWindowHidden(onVisibility);
    running.add(store);
    void tick();
  };
  const stop = (): void => {
    active = false;
    clearTimeout(timer);
    stopWatchingHidden?.();
    stopWatchingHidden = undefined;
    running.delete(store);
  };

  const store: CoreStatusStore = {
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return (): void => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    getSnapshot: () => snapshot,
    boost: () => {
      boostUntil = Date.now() + STATUS_BOOST_MS;
      pollNow();
    },
  };
  return store;
}

const stores = new WeakMap<CoreClients, CoreStatusStore>();

/** Общее хранилище статуса для данных клиентов ядра (новые клиенты — новый статус, T-03). */
export function coreStatusStore(core: CoreClients): CoreStatusStore {
  let store = stores.get(core);
  if (store === undefined) {
    store = createStore(core);
    stores.set(core, store);
  }
  return store;
}
