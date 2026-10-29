// SPDX-License-Identifier: GPL-3.0-only

// screen_connection.tun.test.tsx — T-46: без прав администратора режим TUN
// объясняет, что делать, и не пытается подключаться. Ядро — мок fetch,
// оболочка — мок invoke.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CoreContext } from '../hooks/useCore';
import { createCoreClients, type CoreClients } from '../lib/core';
import { toggleConnection } from '../lib/connection';
import { setLanguage } from '../lib/i18n';
import { ConnectionScreen } from './screen_connection';

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }));

const paths: string[] = [];

function installCore(): void {
  globalThis.fetch = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(href).pathname;
    paths.push(path);
    // activeProfileId задан явно: без него экран в IDLE не рисует кнопку (T-04).
    const body = path.endsWith('.CoreService/GetStatus')
      ? { state: 'CORE_STATE_IDLE', activeProfileId: '0', inbound: { port: 2080 } }
      : path.endsWith('.ProfileService/ListProfiles')
        ? { profiles: [{ id: '1', name: 'Frankfurt 01', address: 'example.org', port: 443 }] }
        : {};
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

const connectCalls = (): number => paths.filter((p) => p.endsWith('.CoreService/Connect')).length;
const button = (): HTMLButtonElement | null => document.querySelector('button.btn-lg');
const notice = (): Element | null => document.querySelector('.banner-warn');

describe('TUN without administrator rights (T-46)', () => {
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    window.localStorage.clear();
    setLanguage('en');
    paths.length = 0;
    installCore();
    root = createRoot(document.body.appendChild(document.createElement('div')));
  });
  afterEach(() => {
    act(() => {
      root.unmount();
    });
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  async function open(tun: boolean, elevated: boolean): Promise<void> {
    window.localStorage.setItem('lavray.modes', JSON.stringify({ sysProxy: false, tunMode: tun }));
    shell.invoke.mockReset().mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'is_elevated' ? elevated : null),
    );
    const clients = createCoreClients('http://127.0.0.1:1');
    act(() => {
      root.render(
        <CoreContext.Provider value={clients}>
          <ConnectionScreen />
        </CoreContext.Provider>,
      );
    });
    for (let i = 0; i < 40 && (button() === null || (tun && !elevated && notice() === null)); i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }

  it('explains what to do before connecting and does not try to connect', async () => {
    await open(true, false);
    expect(notice()?.textContent).toContain('To use TUN, run LAVRay as administrator');
    expect(button()?.disabled).toBe(true);
    act(() => {
      button()?.click();
    });
    expect(connectCalls()).toBe(0);

    setLanguage('ru');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(notice()?.textContent).toContain('Для TUN запустите LAVRay от имени администратора');
  });

  it('connects in TUN mode when the shell is elevated; no TUN — no warning', async () => {
    await open(true, true);
    expect(notice()).toBeNull();
    await act(async () => {
      button()?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(connectCalls()).toBe(1);

    act(() => {
      root.unmount();
    });
    root = createRoot(document.body.appendChild(document.createElement('div')));
    await open(false, false);
    expect(notice()).toBeNull();
    expect(button()?.disabled).toBe(false);
  });

  it('Ctrl+D / menu path: toggleConnection does not connect and lets the screen explain', async () => {
    window.localStorage.setItem('lavray.modes', JSON.stringify({ sysProxy: false, tunMode: true }));
    shell.invoke.mockReset().mockResolvedValue(false);
    const connect = vi.fn();
    const core = { core: { connect }, profiles: { listProfiles: vi.fn() } } as unknown as CoreClients;

    expect(await toggleConnection({ core, connected: false, port: 2080 })).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });
});
