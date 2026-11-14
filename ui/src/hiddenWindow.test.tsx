// SPDX-License-Identifier: GPL-3.0-only

// hiddenWindow.test.tsx — окно скрыто в трей: таймеры, потоки и перерисовки
// стоят, при показе всё возобновляется сразу, а опрос статуса (трей, системный
// прокси, kill switch, автоподключение) не останавливается.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import type { JSX } from 'react';
import { create } from '@bufbuild/protobuf';
import {
  ConnectMode,
  CoreState,
  CoreStatusSchema,
  InboundInfoSchema,
  StatsSnapshotSchema,
  TagStatSchema,
} from './gen/lavray_pb';
import type { ConnectionSnapshot, CoreStatus, StatsSnapshot } from './gen/lavray_pb';
import { TrafficGraph } from './components/TrafficGraph';
import { useCoreStatus } from './hooks/useCore';
import { useConnections } from './hooks/useConnections';
import type { UseConnections } from './hooks/useConnections';
import { useStatusBarModes } from './hooks/useStatusBarModes';
import { useSystemProxyFollow } from './hooks/useSystemProxyFollow';
import { useWindowActivity } from './hooks/useWindowActivity';
import { applySystemProxy, saveModes } from './lib/connection';
import { STATUS_POLL_HIDDEN_MS, STATUS_POLL_MS } from './lib/coreStatusStore';
import { conn, createFeed, drain, frame, mountWithCore, tick } from './test-utils/connsKit';
import type { Mounted } from './test-utils/connsKit';

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }));

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

let host: Mounted | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  setHidden(false);
});
afterEach(() => {
  host?.unmount();
  host = undefined;
  setHidden(false);
  vi.useRealTimers();
  vi.restoreAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

const statusOf = (state: CoreState): CoreStatus =>
  create(CoreStatusSchema, {
    state,
    mode: ConnectMode.SYSTEM_PROXY,
    coreVersion: '0.1.0',
    inbound: create(InboundInfoSchema, { listen: '127.0.0.1', port: 2081 }),
  });

describe('системный прокси в скрытом окне', () => {
  beforeEach(async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    window.localStorage.clear();
    shell.invoke.mockReset().mockResolvedValue('');
    await applySystemProxy(false, 0);
    shell.invoke.mockClear();
  });
  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    window.localStorage.clear();
  });

  function Follow(): JSX.Element | null {
    useSystemProxyFollow(useCoreStatus());
    return null;
  }

  it('подключение, пришедшее при скрытом окне, применяет прокси на ближайшем опросе, и только один раз', async () => {
    let state = CoreState.IDLE;
    const getStatus = vi.fn(() => Promise.resolve(statusOf(state)));
    host = await mountWithCore({ core: { getStatus } }, createElement(Follow));
    await tick(0);
    setHidden(true);
    await tick(STATUS_POLL_MS); // последний «видимый» таймер
    state = CoreState.CONNECTED; // другой клиент (MCP) подключил ядро
    await tick(STATUS_POLL_HIDDEN_MS);
    const calls = (): unknown[] =>
      shell.invoke.mock.calls.filter(([cmd]) => cmd === 'set_system_proxy').map(([, a]) => a);
    expect(calls()).toEqual([{ enabled: true, port: 2081 }]);

    await tick(STATUS_POLL_HIDDEN_MS * 3);
    setHidden(false); // показ окна не применяет прокси повторно
    await tick(STATUS_POLL_MS * 2);
    expect(calls()).toHaveLength(1);

    state = CoreState.IDLE; // отключение при скрытом окне снимает прокси
    setHidden(true);
    await tick(STATUS_POLL_HIDDEN_MS * 2);
    expect(calls()).toEqual([
      { enabled: true, port: 2081 },
      { enabled: false, port: 1 },
    ]);
  });
});

describe('поток соединений', () => {
  const coreOf = (f: ReturnType<typeof createFeed<ConnectionSnapshot>>): unknown => ({
    connections: { watchConnections: f.stream },
  });
  let latest: UseConnections;
  function Probe(): null {
    latest = useConnections(true);
    return null;
  }

  it('скрытое окно закрывает поток и сохраняет историю; показ открывает его снова', async () => {
    const feed = createFeed<ConnectionSnapshot>();
    host = await mountWithCore(coreOf(feed), createElement(Probe));
    expect(feed.opens).toHaveLength(1);
    feed.push(frame([conn('a'), conn('b')]));
    await drain();
    feed.push(frame([conn('a')]));
    await drain();
    expect(latest.view.closed.items.map((c) => c.id)).toEqual(['b']);

    act(() => {
      setHidden(true);
    });
    expect(feed.opens[0]?.signal?.aborted).toBe(true);
    await tick(60_000);
    expect(feed.opens).toHaveLength(1); // без переподключений и опросов
    expect(latest.view.closed.items.map((c) => c.id)).toEqual(['b']); // история не сброшена

    act(() => {
      setHidden(false);
    });
    await drain();
    expect(feed.opens).toHaveLength(2);
  });

  it('при скрытом окне с самого запуска поток не открывается вовсе', async () => {
    setHidden(true);
    const feed = createFeed<ConnectionSnapshot>();
    host = await mountWithCore(coreOf(feed), createElement(Probe));
    expect(feed.opens).toHaveLength(0);
    act(() => {
      setHidden(false);
    });
    await drain();
    expect(feed.opens).toHaveLength(1);
  });
});

describe('поток статистики и график', () => {
  const sample = (down: number): StatsSnapshot =>
    create(StatsSnapshotSchema, { tags: [create(TagStatSchema, { tag: 'p', downlinkBps: down, uplinkBps: 1 })] });

  it('скрыто: поток закрыт, интервал перерисовки снят; показ: поток открыт, график перерисован сразу', async () => {
    const feed = createFeed<StatsSnapshot>();
    const setIv = vi.spyOn(window, 'setInterval');
    const clearIv = vi.spyOn(window, 'clearInterval');
    host = await mountWithCore({ stats: { subscribe: feed.stream } }, createElement(TrafficGraph, { active: true }));
    const intervals = (): number => setIv.mock.calls.filter(([, ms]) => ms === 900).length;
    expect(feed.opens).toHaveLength(1);
    expect(intervals()).toBe(1);
    feed.push(sample(100));
    await drain();

    act(() => {
      setHidden(true);
    });
    expect(feed.opens[0]?.signal?.aborted).toBe(true);
    expect(clearIv).toHaveBeenCalled();
    const before = intervals();
    await tick(30_000);
    expect(intervals()).toBe(before);
    expect(feed.opens).toHaveLength(1);

    act(() => {
      setHidden(false);
    });
    await drain();
    expect(feed.opens).toHaveLength(2);
    expect(intervals()).toBe(before + 1);
  });
});

describe('режимы статус-бара', () => {
  let seen: string;
  function Modes(): null {
    const [modes] = useStatusBarModes();
    seen = modes.sysProxy ? 'on' : 'off';
    return null;
  }

  it('скрыто: localStorage не опрашивается; показ: режимы перечитаны сразу', async () => {
    saveModes(window.localStorage, { sysProxy: false, tunMode: false });
    host = await mountWithCore({}, createElement(Modes));
    expect(seen).toBe('off');
    act(() => {
      setHidden(true);
    });
    saveModes(window.localStorage, { sysProxy: true, tunMode: false });
    await tick(10_000);
    expect(seen).toBe('off');
    act(() => {
      setHidden(false);
    });
    expect(seen).toBe('on');
  });

  it('видимое окно: режимы подхватываются по таймеру, как раньше', async () => {
    saveModes(window.localStorage, { sysProxy: false, tunMode: false });
    host = await mountWithCore({}, createElement(Modes));
    saveModes(window.localStorage, { sysProxy: true, tunMode: false });
    await tick(1600);
    expect(seen).toBe('on');
  });
});

describe('html[data-hidden]', () => {
  function Activity(): null {
    useWindowActivity();
    return null;
  }

  it('ставится, пока окно скрыто, и снимается при показе и размонтировании', async () => {
    host = await mountWithCore({}, createElement(Activity));
    const flag = (): string | undefined => document.documentElement.dataset.hidden;
    expect(flag()).toBeUndefined();
    act(() => {
      setHidden(true);
    });
    expect(flag()).toBe('1');
    act(() => {
      setHidden(false);
    });
    expect(flag()).toBeUndefined();
    act(() => {
      setHidden(true);
    });
    host.unmount();
    host = undefined;
    expect(flag()).toBeUndefined();
  });
});
