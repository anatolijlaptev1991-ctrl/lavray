// SPDX-License-Identifier: GPL-3.0-only

// TrafficGraph.test.tsx — слушатель resize и интервал перерисовки создаются
// один раз, а не на каждый кадр статистики.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import { StatsSnapshotSchema, TagStatSchema } from '../gen/lavray_pb';
import type { StatsSnapshot } from '../gen/lavray_pb';
import { createFeed, drain, mountWithCore } from '../test-utils/connsKit';
import type { Mounted } from '../test-utils/connsKit';
import { TrafficGraph } from './TrafficGraph';

const frameOf = (down: number): StatsSnapshot =>
  create(StatsSnapshotSchema, { tags: [create(TagStatSchema, { tag: 'p', downlinkBps: down, uplinkBps: 1 })] });

describe('TrafficGraph', () => {
  let host: Mounted | undefined;
  afterEach(() => {
    host?.unmount();
    vi.restoreAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('не пересоздаёт resize-слушатель и интервал на каждом кадре', async () => {
    const feed = createFeed<StatsSnapshot>();
    const add = vi.spyOn(window, 'addEventListener');
    const setIv = vi.spyOn(window, 'setInterval');
    host = await mountWithCore({ stats: { subscribe: feed.stream } }, createElement(TrafficGraph, { active: true }));
    const resizeAdds = (): number => add.mock.calls.filter(([type]) => type === 'resize').length;
    const intervals = (): number => setIv.mock.calls.filter(([, ms]) => ms === 900).length;
    const before = [resizeAdds(), intervals()];
    for (let i = 1; i <= 5; i += 1) {
      feed.push(frameOf(i * 100));
      await drain();
    }
    expect(before).toEqual([1, 1]);
    expect([resizeAdds(), intervals()]).toEqual([1, 1]);
  });
});
