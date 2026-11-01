// SPDX-License-Identifier: GPL-3.0-only

// killSwitchOrder.test.tsx — порядок событий при падении ядра с kill switch (хвосты B).
// Оболочка шлёт `core-endpoint` «адреса нет», а `proxy-kept` может прийти позже: окно к
// этому моменту видит CONNECTED → IDLE и по правилу «следовать за ядром» снимало бы
// прокси само. Теперь перед снятием оно спрашивает оболочку (`proxy_kept`), и прокси
// остаётся, в каком бы порядке ни пришли события. Tauri подставной.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import { ConnectMode, CoreState, CoreStatusSchema, type CoreStatus } from '../gen/lavray_pb';
import { applySystemProxy, isSystemProxyApplied, markSystemProxy } from '../lib/connection';
import { clearProxyKept, isProxyKept } from '../lib/killSwitch';
import { setLanguage } from '../lib/i18n';
import { CoreContext } from './useCore';
import { createCoreClients } from '../lib/core';
import { useKillSwitch } from './useKillSwitch';
import { useSystemProxyFollow } from './useSystemProxyFollow';

const shell = vi.hoisted(() => ({
  /** Что отвечает оболочка на `proxy_kept`. */
  kept: false,
  handlers: new Map<string, () => void>(),
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: () => void): Promise<() => void> => {
    shell.handlers.set(name, handler);
    return Promise.resolve(() => {
      shell.handlers.delete(name);
    });
  },
}));

const status = (state: CoreState): CoreStatus =>
  create(CoreStatusSchema, { state, mode: ConnectMode.SYSTEM_PROXY });

function Probe({ state }: { state: CoreState }): JSX.Element | null {
  useSystemProxyFollow(status(state));
  useKillSwitch({ 'connect.kill_switch_proxy': true }, state);
  return null;
}

const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** Вызовы set_system_proxy(enabled=false): снятие прокси окном. */
const releases = (): unknown[] =>
  shell.invoke.mock.calls.filter(([cmd, args]) => cmd === 'set_system_proxy' && !(args as { enabled: boolean }).enabled);

describe('kill switch: порядок событий', () => {
  let root: Root;
  const render = async (state: CoreState): Promise<void> => {
    act(() => {
      root.render(
        <CoreContext.Provider value={createCoreClients('http://127.0.0.1:1')}>
          <Probe state={state} />
        </CoreContext.Provider>,
      );
    });
    await flush();
  };

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    window.localStorage.clear();
    setLanguage('en');
    shell.kept = false;
    shell.handlers.clear();
    shell.invoke.mockReset().mockImplementation((cmd) => Promise.resolve(cmd === 'proxy_kept' ? shell.kept : ''));
    clearProxyKept();
    markSystemProxy(false);
    root = createRoot(document.body.appendChild(document.createElement('div')));
    await render(CoreState.IDLE);
    await act(async () => {
      await applySystemProxy(true, 2080); // окно включило системный прокси при подключении
    });
    shell.invoke.mockClear();
  });
  afterEach(() => {
    act(() => {
      root.unmount();
    });
    clearProxyKept();
    markSystemProxy(false);
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('«адреса нет» раньше proxy-kept: прокси не снимается, флаг ставится, когда событие доходит', async () => {
    await render(CoreState.CONNECTED);
    // Оболочка уже поставила флаг (раньше любого события), но proxy-kept окно ещё не получило.
    shell.kept = true;
    await render(CoreState.IDLE); // core-endpoint down → useCore сбросил статус в IDLE

    expect(releases()).toEqual([]);
    expect(isSystemProxyApplied()).toBe(true);
    expect(isProxyKept()).toBe(true); // окно узнало от оболочки, не дожидаясь события

    await act(async () => {
      shell.handlers.get('proxy-kept')?.();
      await Promise.resolve();
    });
    expect(releases()).toEqual([]);
    expect(isProxyKept()).toBe(true);
  });

  it('proxy-kept раньше «адреса нет»: прокси тоже остаётся', async () => {
    await render(CoreState.CONNECTED);
    await act(async () => {
      shell.handlers.get('proxy-kept')?.();
      await Promise.resolve();
    });
    await render(CoreState.IDLE);
    expect(releases()).toEqual([]);
    expect(isSystemProxyApplied()).toBe(true);
  });

  it('kill switch не сработал (оболочка вернула прокси сама): окно по-прежнему снимает флаг «применён»', async () => {
    await render(CoreState.CONNECTED);
    shell.kept = false;
    await render(CoreState.IDLE);
    expect(releases()).toHaveLength(1); // обычное следование за ядром (MCP) работает как раньше
    expect(isSystemProxyApplied()).toBe(false);
  });

  it('перезагрузка окна: оболочка помнит «оставлен» — баннер возвращается без события', async () => {
    markSystemProxy(false); // свежая страница не знает, что применяла прокси
    clearProxyKept();
    shell.kept = true;
    act(() => {
      root.unmount();
    });
    root = createRoot(document.body.appendChild(document.createElement('div')));
    await render(CoreState.IDLE);
    expect(isProxyKept()).toBe(true);
    expect(isSystemProxyApplied()).toBe(true);
  });
});
