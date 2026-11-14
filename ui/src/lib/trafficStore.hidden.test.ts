// SPDX-License-Identifier: GPL-3.0-only

// trafficStore.hidden.test.ts — поток статистики закрыт, пока окно скрыто в трей,
// и открывается заново при показе; последняя скорость при показе обнулена.
import { afterEach, describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { StatsSnapshotSchema, TagStatSchema } from '../gen/lavray_pb';
import type { StatsSnapshot } from '../gen/lavray_pb';
import { createFeed } from '../test-utils/connsKit';
import type { CoreClients } from './core';
import { trafficStore } from './trafficStore';

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};
const frameOf = (down: number): StatsSnapshot =>
  create(StatsSnapshotSchema, { tags: [create(TagStatSchema, { tag: 'p', downlinkBps: down, uplinkBps: 1 })] });

afterEach(() => {
  setHidden(false);
});

describe('trafficStore в скрытом окне', () => {
  it('заявка при скрытом окне потока не открывает; показ открывает', async () => {
    setHidden(true);
    const feed = createFeed<StatsSnapshot>();
    const store = trafficStore({ stats: { subscribe: feed.stream } } as unknown as CoreClients);
    const release = store.acquire();
    await settle();
    expect(feed.opens).toHaveLength(0);
    setHidden(false);
    await settle();
    expect(feed.opens).toHaveLength(1);
    release();
  });

  it('скрытие закрывает поток, показ открывает новый и обнуляет устаревшую скорость', async () => {
    const feed = createFeed<StatsSnapshot>();
    const store = trafficStore({ stats: { subscribe: feed.stream } } as unknown as CoreClients);
    const release = store.acquire();
    await settle();
    feed.push(frameOf(900));
    await settle();
    expect(store.getSnapshot().reading.speed.down).toBe(900);

    setHidden(true);
    expect(feed.opens[0]?.signal?.aborted).toBe(true);
    expect(store.getSnapshot().reading.speed.down).toBe(900); // в скрытом окне лишних уведомлений нет

    setHidden(false);
    await settle();
    expect(feed.opens).toHaveLength(2);
    expect(store.getSnapshot().reading.speed.down).toBe(0);
    feed.push(frameOf(5));
    await settle();
    expect(store.getSnapshot().reading.speed.down).toBe(5);
    release();
    expect(feed.opens[1]?.signal?.aborted).toBe(true);
  });
});
