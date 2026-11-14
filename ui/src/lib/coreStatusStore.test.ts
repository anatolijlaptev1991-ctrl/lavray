// SPDX-License-Identifier: GPL-3.0-only

// coreStatusStore.test.ts — общий опрос статуса: один поток на всех потребителей,
// без наложения запросов, пауза в скрытом окне, без лишних уведомлений.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { CoreState, CoreStatusSchema } from '../gen/lavray_pb';
import type { CoreStatus } from '../gen/lavray_pb';
import type { CoreClients } from './core';
import { boostStatusPolling, coreStatusStore, STATUS_BOOST_MS, STATUS_POLL_HIDDEN_MS, STATUS_POLL_MS } from './coreStatusStore';

const st = (state: CoreState): CoreStatus => create(CoreStatusSchema, { state, coreVersion: '1' });

function fakeCore(getStatus: () => Promise<CoreStatus>): { core: CoreClients; calls: () => number } {
  const fn = vi.fn(getStatus);
  return { core: { core: { getStatus: fn } } as unknown as CoreClients, calls: () => fn.mock.calls.length };
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('coreStatusStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    setHidden(false);
    vi.useRealTimers();
  });

  it('много потребителей — один поток запросов', async () => {
    const { core, calls } = fakeCore(() => Promise.resolve(st(CoreState.IDLE)));
    const store = coreStatusStore(core);
    const unsubs = Array.from({ length: 5 }, () => store.subscribe(() => undefined));
    expect(coreStatusStore(core)).toBe(store);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS * 3);
    expect(calls()).toBe(4);
    unsubs.forEach((u) => {
      u();
    });
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS * 3);
    expect(calls()).toBe(4);
  });

  it('медленный RPC не создаёт очередь', async () => {
    const resolvers: ((s: CoreStatus) => void)[] = [];
    const { core, calls } = fakeCore(
      () => new Promise<CoreStatus>((r) => { resolvers.push(r); }),
    );
    const unsub = coreStatusStore(core).subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS * 10);
    expect(calls()).toBe(1);
    resolvers[0]?.(st(CoreState.IDLE));
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS - 1);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls()).toBe(2);
    unsub();
  });

  it('одинаковый снимок не уведомляет подписчиков, изменение — уведомляет', async () => {
    let next = st(CoreState.IDLE);
    const { core } = fakeCore(() => Promise.resolve(create(CoreStatusSchema, next)));
    const store = coreStatusStore(core);
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    await vi.advanceTimersByTimeAsync(0);
    const first = store.getSnapshot();
    expect(listener).toHaveBeenCalledTimes(1); // первый ответ отличается от начального
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS * 3);
    expect(store.getSnapshot()).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);
    next = st(CoreState.CONNECTED);
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().state).toBe(CoreState.CONNECTED);
    unsub();
  });

  it('скрытое окно: опрос идёт реже, но не стоит; возврат обновляет сразу', async () => {
    const { core, calls } = fakeCore(() => Promise.resolve(st(CoreState.IDLE)));
    const unsub = coreStatusStore(core).subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(1);
    setHidden(true);
    await vi.advanceTimersByTimeAsync(STATUS_POLL_HIDDEN_MS * 5);
    // Реже, чем при видимом окне (там было бы 11), но опрос идёт.
    expect(calls()).toBeGreaterThanOrEqual(5);
    expect(calls()).toBeLessThanOrEqual(7);
    const before = calls();
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(before + 1);
    unsub();
  });

  it('скрытое окно: ровно один запрос за STATUS_POLL_HIDDEN_MS (5 с), а не раз в секунду', async () => {
    const { core, calls } = fakeCore(() => Promise.resolve(st(CoreState.CONNECTED)));
    setHidden(true);
    const unsub = coreStatusStore(core).subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(STATUS_POLL_HIDDEN_MS - 1);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls()).toBe(2);
    unsub();
  });

  it('скрытое окно: переходное состояние опрашивается в обычном темпе', async () => {
    let next = st(CoreState.CONNECTING);
    const { core, calls } = fakeCore(() => Promise.resolve(create(CoreStatusSchema, next)));
    setHidden(true);
    const unsub = coreStatusStore(core).subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS * 3);
    expect(calls()).toBe(4);
    next = st(CoreState.CONNECTED);
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS);
    const settled = calls();
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS * 3); // подключено: снова редко
    expect(calls()).toBe(settled);
    unsub();
  });

  it('boostStatusPolling: опрос сейчас и в обычном темпе STATUS_BOOST_MS даже в скрытом окне', async () => {
    const { core, calls } = fakeCore(() => Promise.resolve(st(CoreState.IDLE)));
    setHidden(true);
    const unsub = coreStatusStore(core).subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(1);
    boostStatusPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS * 3);
    expect(calls()).toBe(5);
    await vi.advanceTimersByTimeAsync(STATUS_BOOST_MS); // подъём закончился
    const after = calls();
    await vi.advanceTimersByTimeAsync(STATUS_POLL_HIDDEN_MS);
    expect(calls()).toBeLessThanOrEqual(after + 1);
    unsub();
    boostStatusPolling(); // без подписчиков — ничего не падает
  });

  it('переход подключено → отключено в скрытом окне доходит до подписчика', async () => {
    let next = st(CoreState.CONNECTED);
    const { core } = fakeCore(() => Promise.resolve(create(CoreStatusSchema, next)));
    const store = coreStatusStore(core);
    setHidden(true);
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().state).toBe(CoreState.CONNECTED);
    next = st(CoreState.IDLE);
    await vi.advanceTimersByTimeAsync(STATUS_POLL_HIDDEN_MS);
    expect(store.getSnapshot().state).toBe(CoreState.IDLE);
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
  });

  it('ошибка RPC сохраняется в lastError без потери прочих полей', async () => {
    const { core } = fakeCore(() => Promise.reject(new Error('boom')));
    const store = coreStatusStore(core);
    const unsub = store.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().lastError).not.toBe('');
    unsub();
  });
});
