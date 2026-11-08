// SPDX-License-Identifier: GPL-3.0-only

// useProfiles: поиск уходит в ядро после паузы набора, ответы устаревших
// запросов игнорируются (latest-only), прежний запрос отменяется сигналом.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import { ListProfilesResponseSchema, ProfileSchema } from '../gen/lavray_pb';
import type { ListProfilesResponse } from '../gen/lavray_pb';
import { mountWithCore } from '../test-utils/connsKit';
import type { Mounted } from '../test-utils/connsKit';
import { SEARCH_DEBOUNCE_MS, useProfiles } from './useCore';

interface Call { search: string | undefined; signal: AbortSignal | undefined; resolve: (n: string) => void }

const reply = (name: string): ListProfilesResponse =>
  create(ListProfilesResponseSchema, { profiles: [create(ProfileSchema, { name })], total: 1n });

describe('useProfiles: debounce и latest-only', () => {
  let host: Mounted | undefined;
  let calls: Call[];
  let shown: string;

  function Probe({ search }: { readonly search: string }): null {
    shown = useProfiles(search).profiles.map((p) => p.name).join(',');
    return null;
  }
  const core = (): unknown => ({
    profiles: {
      listProfiles: (req: { search?: string }, opts?: { signal?: AbortSignal }): Promise<ListProfilesResponse> =>
        new Promise((resolve) => {
          calls.push({ search: req.search, signal: opts?.signal, resolve: (n) => { resolve(reply(n)); } });
        }),
    },
  });
  const wait = async (ms: number): Promise<void> => {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    shown = '';
  });
  afterEach(() => {
    host?.unmount();
    vi.useRealTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('быстрый набор даёт один запрос с последним текстом', async () => {
    host = await mountWithCore(core(), createElement(Probe, { search: '' }));
    expect(calls).toHaveLength(1); // первое значение уходит сразу
    for (const s of ['a', 'ab', 'abc']) {
      await host.rerender(createElement(Probe, { search: s }));
      await wait(SEARCH_DEBOUNCE_MS / 4);
    }
    expect(calls).toHaveLength(1);
    await wait(SEARCH_DEBOUNCE_MS);
    expect(calls.map((c) => c.search)).toEqual([undefined, 'abc']);
  });

  it('устаревший ответ игнорируется и его запрос отменён', async () => {
    host = await mountWithCore(core(), createElement(Probe, { search: '' }));
    await host.rerender(createElement(Probe, { search: 'x' }));
    await wait(SEARCH_DEBOUNCE_MS);
    await host.rerender(createElement(Probe, { search: 'xy' }));
    await wait(SEARCH_DEBOUNCE_MS);
    expect(calls).toHaveLength(3);
    expect(calls[1]?.signal?.aborted).toBe(true);
    await act(async () => { calls[2]?.resolve('new'); await Promise.resolve(); });
    expect(shown).toBe('new');
    await act(async () => { calls[1]?.resolve('stale'); await Promise.resolve(); });
    expect(shown).toBe('new');
  });
});
