// SPDX-License-Identifier: GPL-3.0-only

// useTraffic.test.tsx — скорость и итоги сессии из StatsService.Subscribe (T-79):
// сумма по тегам (включая `other`), финальный кадр, ошибка, отписка, отсутствие
// «выброса» до первого кадра. Ядро подставное, поток управляется из теста.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import { ConnectError, Code } from '@connectrpc/connect';
import { SessionStatSchema, StatsSnapshotSchema, TagStatSchema } from '../gen/lavray_pb';
import type { StatsSnapshot, TagStat } from '../gen/lavray_pb';
import { setLanguage } from '../lib/i18n';
import { createFeed, drain, mountWithCore, tick } from '../test-utils/connsKit';
import type { Feed, Mounted } from '../test-utils/connsKit';
import { useTrafficSpeed, useTrafficStats } from './useTraffic';
import type { Speed, TrafficStats } from './useTraffic';

const tag = (name: string, down: number, up: number): TagStat =>
  create(TagStatSchema, { tag: name, downlinkBps: down, uplinkBps: up });

function snap(tags: TagStat[], extra: { final?: boolean; down?: bigint; up?: bigint } = {}): StatsSnapshot {
  return create(StatsSnapshotSchema, {
    tags,
    final: extra.final ?? false,
    ...(extra.down === undefined
      ? {}
      : { session: create(SessionStatSchema, { downlinkTotal: extra.down, uplinkTotal: extra.up ?? 0n }) }),
  });
}

let latest: TrafficStats;
let samples: Speed[];
let feed: Feed<StatsSnapshot>;
let host: Mounted | undefined;

function Probe({ active }: { readonly active: boolean }): null {
  latest = useTrafficStats(active, (s) => samples.push(s));
  return null;
}

const coreOf = (f: Feed<StatsSnapshot>): unknown => ({ stats: { subscribe: f.stream } });

async function mountProbe(active = true): Promise<void> {
  host = await mountWithCore(coreOf(feed), createElement(Probe, { active }));
}

describe('useTraffic (T-79)', () => {
  beforeEach(() => {
    setLanguage('en');
    feed = createFeed<StatsSnapshot>();
    samples = [];
    host = undefined;
  });
  afterEach(() => {
    host?.unmount();
    vi.useRealTimers();
    setLanguage('en');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('sums_tags: скорость — сумма по всем тегам, включая other', async () => {
    await mountProbe();
    feed.push(snap([tag('proxy', 1000, 100), tag('direct', 500, 50), tag('other', 25, 5)]));
    await drain();
    expect(latest.speed).toEqual({ down: 1525, up: 155 });
  });

  it('sums_tags: подписка идёт с интервалом 1 с и без фильтра тегов', async () => {
    await mountProbe();
    expect(feed.opens).toHaveLength(1);
    expect(feed.opens[0]?.request).toEqual({ intervalMs: 1000 });
  });

  it('итоги сессии берутся из session и остаются между кадрами без session', async () => {
    await mountProbe();
    feed.push(snap([tag('proxy', 10, 1)], { down: 5000n, up: 700n }));
    await drain();
    expect(latest.totals).toEqual({ down: 5000, up: 700 });
    feed.push(snap([tag('proxy', 20, 2)]));
    await drain();
    expect(latest.speed).toEqual({ down: 20, up: 2 });
    expect(latest.totals).toEqual({ down: 5000, up: 700 });
  });

  it('final_resets: финальный кадр обнуляет скорость, итоги остаются, поток не переоткрывается', async () => {
    await mountProbe();
    feed.push(snap([tag('proxy', 900, 90)]));
    await drain();
    expect(latest.speed.down).toBe(900);
    feed.push(snap([], { final: true, down: 123_456n, up: 7_890n }));
    await drain();
    expect(latest.speed).toEqual({ down: 0, up: 0 });
    expect(latest.totals).toEqual({ down: 123_456, up: 7_890 });
    expect(samples.at(-1)).toEqual({ down: 0, up: 0 });
    expect(feed.opens).toHaveLength(1); // следующую сессию ядро отдаст в тот же поток
    feed.push(snap([tag('proxy', 300, 30)]));
    await drain();
    expect(latest.speed).toEqual({ down: 300, up: 30 });
  });

  it('no_spike_before_first_frame: до первого кадра — нули и ни одной точки графика', async () => {
    await mountProbe();
    expect(feed.opens).toHaveLength(1); // подписка есть, кадров нет — это не ошибка
    expect(latest.speed).toEqual({ down: 0, up: 0 });
    expect(latest.totals).toEqual({ down: 0, up: 0 });
    expect(latest.error).toBe('');
    expect(samples.filter((s) => s.down !== 0 || s.up !== 0)).toEqual([]);
  });

  it('no_spike_before_first_frame: первый настоящий кадр показывается как есть, без «разгона»', async () => {
    await mountProbe();
    feed.push(snap([tag('proxy', 4096, 1024)]));
    await drain();
    expect(samples).toEqual([{ down: 4096, up: 1024 }]);
    expect(latest.speed).toEqual({ down: 4096, up: 1024 });
  });

  it('no_spike_before_first_frame: новая сессия начинается с нулей, а не со скорости прошлой', async () => {
    await mountProbe(true);
    feed.push(snap([tag('proxy', 777, 77)], { down: 9n, up: 9n }));
    await drain();
    expect(latest.speed.down).toBe(777);
    await host?.rerender(createElement(Probe, { active: false }));
    await host?.rerender(createElement(Probe, { active: true }));
    expect(latest.speed).toEqual({ down: 0, up: 0 });
    expect(latest.totals).toEqual({ down: 0, up: 0 });
  });

  it('error_exposed: обрыв потока даёт текст ошибки и нулевую скорость; кадр ошибку снимает', async () => {
    vi.useFakeTimers();
    await mountProbe();
    feed.push(snap([tag('proxy', 500, 50)]));
    await drain();
    feed.fail(new ConnectError('boom', Code.Unavailable));
    await drain();
    expect(latest.error).toContain('boom');
    expect(latest.speed).toEqual({ down: 0, up: 0 });
    await tick(1000); // переподключение через 1 с
    expect(feed.opens).toHaveLength(2);
    feed.push(snap([tag('proxy', 800, 80)]));
    await drain();
    expect(latest.error).toBe('');
    expect(latest.speed).toEqual({ down: 800, up: 80 });
  });

  it('error_exposed: недоступность ядра переводится на язык интерфейса', async () => {
    vi.useFakeTimers();
    await mountProbe();
    feed.fail(new TypeError('Failed to fetch'));
    await drain();
    expect(latest.error).toBe('Core unavailable — the app is not running or the core did not start');
  });

  it('active=false: подписки нет, показания нулевые', async () => {
    host = await mountWithCore(coreOf(feed), createElement(Probe, { active: false }));
    expect(feed.opens).toHaveLength(0);
    expect(latest.speed).toEqual({ down: 0, up: 0 });
  });

  it('unsubscribe_on_unmount: размонтирование обрывает запрос', async () => {
    await mountProbe();
    const signal = feed.opens[0]?.signal;
    expect(signal?.aborted).toBe(false);
    host?.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('unsubscribe_on_unmount: отключение (active=false) обрывает запрос и обнуляет скорость', async () => {
    await mountProbe(true);
    feed.push(snap([tag('proxy', 100, 10)]));
    await drain();
    const signal = feed.opens[0]?.signal;
    await host?.rerender(createElement(Probe, { active: false }));
    expect(signal?.aborted).toBe(true);
    expect(latest.speed).toEqual({ down: 0, up: 0 });
  });

  it('useTrafficSpeed возвращает только скорость (API статус-бара)', async () => {
    let got: Speed | undefined;
    function SpeedProbe(): null {
      got = useTrafficSpeed(true);
      return null;
    }
    host = await mountWithCore(coreOf(feed), createElement(SpeedProbe));
    feed.push(snap([tag('proxy', 64, 8)]));
    await drain();
    expect(got).toEqual({ down: 64, up: 8 });
    expect(Object.keys(got ?? {}).sort()).toEqual(['down', 'up']);
  });
});
