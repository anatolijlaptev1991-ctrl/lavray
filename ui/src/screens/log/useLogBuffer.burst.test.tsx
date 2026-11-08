// SPDX-License-Identifier: GPL-3.0-only

// useLogBuffer: пачка строк копится в кольце без потерь и перестановок, а в React
// уходит снимками не чаще короткого таймера (коммитов меньше, чем строк).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import type { JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import { GetSettingsResponseSchema, LogLevel, LogLineSchema, SettingValueSchema } from '../../gen/lavray_pb';
import type { LogLine } from '../../gen/lavray_pb';
import type { CoreClients } from '../../lib/core';
import { MAX_LOG_LINES_KEY, MAX_MAX_LOG_LINES, useLogBuffer } from './useLogBuffer';

const line = (i: number): LogLine =>
  create(LogLineSchema, { tsMs: BigInt(i), level: LogLevel.INFO, source: 'core', message: `m${String(i)}` });

/** Поток, управляемый из теста: push кладёт строку, строки отдаются по одной. */
function manualFeed(): { push: (l: LogLine) => void; subscribe: () => AsyncGenerator<LogLine> } {
  const queue: LogLine[] = [];
  let wake: (() => void) | undefined;
  async function* gen(): AsyncGenerator<LogLine> {
    for (;;) {
      const next = queue.shift();
      if (next !== undefined) yield next;
      else await new Promise<void>((r) => { wake = r; });
    }
  }
  return { push: (l): void => { queue.push(l); wake?.(); }, subscribe: gen };
}

function coreWith(feed: ReturnType<typeof manualFeed>, max: number): CoreClients {
  const values = { [MAX_LOG_LINES_KEY]: create(SettingValueSchema, { value: { case: 'intValue', value: BigInt(max) } }) };
  return {
    logs: { subscribe: () => feed.subscribe() },
    settings: { getSettings: () => Promise.resolve(create(GetSettingsResponseSchema, { values })) },
  } as unknown as CoreClients;
}

describe('useLogBuffer: пачки строк', () => {
  let root: Root;
  let host: HTMLDivElement;
  let commits = 0;
  let seen: readonly LogLine[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    commits = 0;
    seen = [];
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => { root.unmount(); });
    host.remove();
    vi.useRealTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  function Probe({ core }: { core: CoreClients }): JSX.Element {
    const { lines } = useLogBuffer(core, 200);
    commits += 1;
    seen = lines;
    return createElement('output');
  }
  const settle = async (ms: number): Promise<void> => {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  };
  async function mount(feed: ReturnType<typeof manualFeed>, max: number): Promise<void> {
    act(() => { root.render(createElement(Probe, { core: coreWith(feed, max) })); });
    await settle(0);
  }
  const ids = (): number[] => seen.map((l) => Number(l.tsMs));

  it('burst без потерь и перестановок, коммитов меньше, чем строк', async () => {
    const feed = manualFeed();
    await mount(feed, 5000);
    const before = commits;
    // Строка в миллисекунду: каждая приходит отдельной задачей, а не одним батчем act.
    for (let i = 0; i < 300; i += 1) {
      feed.push(line(i));
      await settle(1);
    }
    await settle(200);
    expect(ids()).toEqual(Array.from({ length: 300 }, (_, i) => i));
    expect(commits - before).toBeLessThan(15);
  });

  it('точный лимит: остаются самые новые, порядок tail+live сохраняется', async () => {
    const feed = manualFeed();
    await mount(feed, 100);
    await act(async () => {
      for (let i = 0; i < 350; i += 1) {
        feed.push(line(i));
        await Promise.resolve();
      }
    });
    await settle(200);
    expect(ids()).toEqual(Array.from({ length: 100 }, (_, i) => 250 + i));
  });

  it('верхняя граница настройки — 50 000 строк', { timeout: 30_000 }, async () => {
    const feed = manualFeed();
    await mount(feed, 10 * MAX_MAX_LOG_LINES);
    await act(async () => {
      for (let i = 0; i < MAX_MAX_LOG_LINES + 25; i += 1) feed.push(line(i));
      await Promise.resolve();
    });
    await settle(500);
    expect(seen).toHaveLength(MAX_MAX_LOG_LINES);
    expect(Number(seen[0]?.tsMs)).toBe(25);
    expect(Number(seen[MAX_MAX_LOG_LINES - 1]?.tsMs)).toBe(MAX_MAX_LOG_LINES + 24);
  });
});
