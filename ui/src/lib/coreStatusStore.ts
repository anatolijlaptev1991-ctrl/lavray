// SPDX-License-Identifier: GPL-3.0-only

// coreStatusStore.ts — общий источник статуса ядра: один цикл опроса GetStatus
// на набор клиентов ядра, сколько бы компонентов ни подписалось (App, экраны).
//
// Следующий запрос уходит только после завершения предыдущего (медленный RPC
// не копит очередь); пока окно скрыто, опрос не останавливается (фоновые
// потребители живут в трее), а лишь замедляется; при возврате — сразу запрос. Снимок заменяется только при изменении полей статуса, поэтому
// одинаковый ответ не вызывает рендера подписчиков.
import { create, equals } from '@bufbuild/protobuf';
import type { CoreClients } from './core';
import { friendlyCoreError } from './core';
import type { CoreStatus } from '../gen/lavray_pb';
import { CoreState, CoreStatusSchema } from '../gen/lavray_pb';

/** Пауза между опросами, считается от завершения предыдущего запроса. */
export const STATUS_POLL_MS = 1000;
/** В скрытом окне (трей) опрос продолжается, но реже: от статуса зависят системный прокси, трей и уведомления. */
export const STATUS_POLL_HIDDEN_MS = 2000;

export interface CoreStatusStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => CoreStatus;
}

const initialStatus = (): CoreStatus =>
  create(CoreStatusSchema, { state: CoreState.IDLE, activeProfileId: 0n, lastError: '' });

const isHidden = (): boolean => typeof document !== 'undefined' && document.hidden;

function createStore(core: CoreClients): CoreStatusStore {
  const listeners = new Set<() => void>();
  let snapshot = initialStatus();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let running = false;

  const publish = (next: CoreStatus): void => {
    if (equals(CoreStatusSchema, snapshot, next)) return;
    snapshot = next;
    listeners.forEach((l) => {
      l();
    });
  };
  const schedule = (): void => {
    if (!running) return;
    timer = setTimeout(() => {
      void tick();
    }, isHidden() ? STATUS_POLL_HIDDEN_MS : STATUS_POLL_MS);
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
  const onVisibility = (): void => {
    if (!running || isHidden()) return;
    clearTimeout(timer);
    void tick();
  };
  const start = (): void => {
    running = true;
    document.addEventListener('visibilitychange', onVisibility);
    void tick();
  };
  const stop = (): void => {
    running = false;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return (): void => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    getSnapshot: () => snapshot,
  };
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
