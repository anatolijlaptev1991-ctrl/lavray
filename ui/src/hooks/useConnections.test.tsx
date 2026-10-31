// SPDX-License-Identifier: GPL-3.0-only

// useConnections.test.tsx — поток WatchConnections → состояние экрана (T-79):
// полный список в каждом кадре, перенос closedIds в историю, пауза, обрыв и
// переподключение, сброс при отключении, отписка. Ядро подставное, кадры
// подаются из теста.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { Code, ConnectError } from '@connectrpc/connect';
import type { ConnectionSnapshot } from '../gen/lavray_pb';
import { Connection_Status } from '../gen/lavray_pb';
import { setLanguage } from '../lib/i18n';
import { conn, createFeed, drain, frame, mountWithCore, tick } from '../test-utils/connsKit';
import type { Feed, Mounted } from '../test-utils/connsKit';
import { useConnections } from './useConnections';
import type { UseConnections } from './useConnections';

let latest: UseConnections;
let feed: Feed<ConnectionSnapshot>;
let host: Mounted | undefined;

function Probe({ active }: { readonly active: boolean }): null {
  latest = useConnections(active);
  return null;
}

const probe = (active: boolean): ReactElement => createElement(Probe, { active });
const coreOf = (f: Feed<ConnectionSnapshot>): unknown => ({ connections: { watchConnections: f.stream } });
const ids = (list: readonly { readonly id: string }[]): string[] => list.map((c) => c.id);

async function mountProbe(active = true): Promise<Mounted> {
  host = await mountWithCore(coreOf(feed), probe(active));
  return host;
}

describe('useConnections (T-79)', () => {
  beforeEach(() => {
    setLanguage('en');
    feed = createFeed<ConnectionSnapshot>();
    host = undefined;
  });
  afterEach(() => {
    host?.unmount();
    vi.useRealTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('подписывается на поток: интервал 1 с и до 500 активных', async () => {
    await mountProbe();
    expect(feed.opens).toHaveLength(1);
    expect(feed.opens[0]?.request).toEqual({ intervalMs: 1000, activePageLimit: 500 });
  });

  it('frame_without_change_keeps_list: кадр без изменений оставляет список и историю', async () => {
    await mountProbe();
    feed.push(frame([conn('a'), conn('b')], ['gone']));
    await drain();
    feed.push(frame([conn('a'), conn('b')]));
    await drain();
    feed.push(frame([conn('a'), conn('b')]));
    await drain();
    expect(ids(latest.view.active)).toEqual(['a', 'b']);
    expect(latest.view.closed.items).toEqual([]);
    expect(latest.error).toBe('');
  });

  it('каждый кадр заменяет список активных целиком', async () => {
    await mountProbe();
    feed.push(frame([conn('a'), conn('b')]));
    await drain();
    feed.push(frame([conn('c')]));
    await drain();
    expect(ids(latest.view.active)).toEqual(['c']);
  });

  it('closed_ids_move_to_history: закрывшееся уходит в историю с последними известными байтами', async () => {
    await mountProbe();
    feed.push(frame([conn('a', { uploadBytes: 11n, downloadBytes: 22n }), conn('b')]));
    await drain();
    feed.push(frame([conn('b')], ['a']));
    await drain();
    expect(ids(latest.view.active)).toEqual(['b']);
    const [moved] = latest.view.closed.items;
    expect(moved?.id).toBe('a');
    expect(moved?.status).toBe(Connection_Status.CLOSED);
    expect(moved?.endedAtMs).toBeDefined();
    expect(moved?.uploadBytes).toBe(11n);
    expect(moved?.downloadBytes).toBe(22n);
  });

  it('truncated из кадра доезжает до экрана', async () => {
    await mountProbe();
    feed.push(frame([conn('a')], [], true));
    await drain();
    expect(latest.view.truncated).toBe(true);
  });

  it('pause_freezes_list: на паузе показ замирает, поток и история продолжают копиться', async () => {
    await mountProbe();
    feed.push(frame([conn('a')]));
    await drain();
    act(() => {
      latest.setPaused(true);
    });
    expect(latest.paused).toBe(true);
    feed.push(frame([conn('a'), conn('b')]));
    await drain();
    feed.push(frame([conn('b')], ['a']));
    await drain();
    expect(ids(latest.view.active)).toEqual(['a']); // показан снимок на момент паузы
    expect(latest.view.closed.items).toEqual([]);
    expect(feed.opens).toHaveLength(1); // поток не переоткрывался

    act(() => {
      latest.setPaused(false);
    });
    expect(latest.paused).toBe(false);
    expect(ids(latest.view.active)).toEqual(['b']);
    expect(ids(latest.view.closed.items)).toEqual(['a']); // закрытое за время паузы не потеряно
  });

  it('stream_error_banner_and_backoff: ошибка для баннера, повторы через 1 с, 2 с, 4 с; кадр снимает ошибку', async () => {
    vi.useFakeTimers();
    await mountProbe();
    expect(feed.opens).toHaveLength(1);

    feed.fail(new ConnectError('stream broke', Code.Unavailable));
    await drain();
    expect(latest.error).toContain('stream broke');

    await tick(999);
    expect(feed.opens).toHaveLength(1);
    await tick(1);
    expect(feed.opens).toHaveLength(2); // 1 с

    feed.fail(new ConnectError('still down', Code.Unavailable));
    await drain();
    expect(latest.error).toContain('still down');
    await tick(1999);
    expect(feed.opens).toHaveLength(2);
    await tick(1);
    expect(feed.opens).toHaveLength(3); // ещё 2 с

    feed.fail(new ConnectError('still down', Code.Unavailable));
    await drain();
    await tick(4000);
    expect(feed.opens).toHaveLength(4); // ещё 4 с

    feed.push(frame([conn('a')]));
    await drain();
    expect(latest.error).toBe(''); // кадр снимает баннер
    expect(ids(latest.view.active)).toEqual(['a']);

    feed.fail(new ConnectError('again', Code.Unavailable));
    await drain();
    await tick(1000);
    expect(feed.opens).toHaveLength(5); // после успешного кадра пауза снова 1 с
  });

  it('недоступность ядра в баннере — понятная фраза, а не «Failed to fetch»', async () => {
    vi.useFakeTimers();
    await mountProbe();
    feed.fail(new TypeError('Failed to fetch'));
    await drain();
    expect(latest.error).toBe('Core unavailable — the app is not running or the core did not start');
  });

  it('«нет кадров» не ошибка: подписка открыта, ошибки нет, повторных открытий нет', async () => {
    vi.useFakeTimers();
    await mountProbe();
    await tick(20_000);
    expect(latest.error).toBe('');
    expect(feed.opens).toHaveLength(1);
  });

  it('disconnect_clears_history: отключение приложения очищает список и историю и обрывает запрос', async () => {
    const m = await mountProbe(true);
    feed.push(frame([conn('a'), conn('b')]));
    await drain();
    feed.push(frame([conn('b')], ['a']));
    await drain();
    expect(ids(latest.view.closed.items)).toEqual(['a']);
    const signal = feed.opens[0]?.signal;

    await m.rerender(probe(false));
    expect(latest.view.active).toEqual([]);
    expect(latest.view.closed.items).toEqual([]);
    expect(signal?.aborted).toBe(true);

    await m.rerender(probe(true)); // новое подключение — история начинается заново
    expect(latest.view.closed.items).toEqual([]);
    expect(feed.opens).toHaveLength(2);
  });

  it('без подключения подписки нет', async () => {
    await mountProbe(false);
    expect(feed.opens).toHaveLength(0);
    expect(latest.view.active).toEqual([]);
    expect(latest.error).toBe('');
  });

  it('unsubscribe_on_unmount: размонтирование обрывает запрос и останавливает повторы', async () => {
    vi.useFakeTimers();
    const m = await mountProbe();
    const signal = feed.opens[0]?.signal;
    expect(signal?.aborted).toBe(false);
    feed.fail(new Error('x'));
    await drain();
    m.unmount();
    expect(signal?.aborted).toBe(true);
    await tick(60_000);
    expect(feed.opens).toHaveLength(1); // таймер переподключения снят
  });
});
