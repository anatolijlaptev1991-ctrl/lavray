// SPDX-License-Identifier: GPL-3.0-only

// App.connection.test.tsx — горячие клавиши и статус-бар настоящего приложения.
// App сам создаёт клиентов, поэтому ядро подменено на уровне fetch.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { warmViews } from './test-harness';
import App from './App';
import { setLanguage } from './lib/i18n';
import { applySystemProxy } from './lib/connection';
import {
  click,
  connectedStatus,
  flush,
  idleStatus,
  mountBare,
  profile,
  profileList,
  stubCore,
  stubMatchMedia,
  unmountAll,
} from './test-utils/coreStub';

const invokeMock = vi.hoisted(() => vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
}

beforeEach(() => {
  stubMatchMedia();
  setLanguage('en');
  window.localStorage.clear();
  window.localStorage.setItem('lavray.onboarded', '1');
  window.location.hash = '';
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

afterEach(async () => {
  unmountAll();
  vi.unstubAllGlobals();
  delete (window as TauriWindow).__TAURI_INTERNALS__;
  await applySystemProxy(false, 1); // сбрасывает флаг «прокси применён» между тестами
});

const ctrl = (key: string): Promise<void> =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true }));
    await Promise.resolve();
  });

beforeAll(warmViews, 60_000);

describe('Ctrl+D (T-26)', () => {
  it('подключает сервер, выбранный на экране «Подключение», а не первый в списке', async () => {
    window.localStorage.setItem('lavray.server', '2');
    window.localStorage.setItem('lavray.modes', JSON.stringify({ sysProxy: false, tunMode: false }));
    const core = stubCore({
      'CoreService/GetStatus': idleStatus(),
      'ProfileService/ListProfiles': profileList(profile('1', 'S1'), profile('2', 'S2')),
    });
    await mountBare(createElement(App));

    await ctrl('d');
    await flush(50);

    expect(core.bodies('CoreService/Connect')).toEqual([
      { profileId: '2', mode: 'CONNECT_MODE_SYSTEM_PROXY' },
    ]);
  });
});

describe('чипы статус-бара показывают фактическое состояние (T-27)', () => {
  const chips = (v: { container: HTMLElement }): string[] =>
    Array.from(v.container.querySelectorAll('#statusbar .st-chip')).map(
      (c) => `${c.textContent?.trim() ?? ''}:${c.classList.contains('on') ? 'on' : 'off'}`,
    );
  const routes = (status: Record<string, unknown>): Record<string, Record<string, unknown>> => ({
    'CoreService/GetStatus': status,
    'ProfileService/ListProfiles': profileList(profile('1', 'S1')),
  });

  it('TUN в настройке, а ядро работает в режиме системного прокси: чип TUN не горит', async () => {
    window.localStorage.setItem('lavray.modes', JSON.stringify({ sysProxy: false, tunMode: true }));
    stubCore(routes(connectedStatus('1', 'S1')));
    const app = await mountBare(createElement(App));

    expect(chips(app)).toEqual(['TUN:off']);
  });

  it('ядро работает в режиме TUN: чип TUN горит, даже если настройка выключена', async () => {
    window.localStorage.setItem('lavray.modes', JSON.stringify({ sysProxy: false, tunMode: false }));
    stubCore(routes(connectedStatus('1', 'S1', 'CONNECT_MODE_TUN')));
    const app = await mountBare(createElement(App));

    expect(chips(app)).toEqual(['TUN:on']);
  });

  it('системный прокси в настройке, но оболочка его не ставила (веб-режим): чип не горит', async () => {
    stubCore(routes(connectedStatus('1', 'S1')));
    const app = await mountBare(createElement(App));

    expect(chips(app)).toEqual(['System proxy:off']);
  });

  it('чип «System proxy» загорается после того, как оболочка применила прокси', async () => {
    (window as TauriWindow).__TAURI_INTERNALS__ = {};
    const core = stubCore(routes(idleStatus()));
    const app = await mountBare(createElement(App));
    expect(chips(app)).toEqual(['System proxy:off']);

    await click(app.container.querySelector('#cxMain .btn-lg'));
    core.routes['CoreService/GetStatus'] = connectedStatus('1', 'S1');
    await flush(1100); // следующий опрос статуса

    expect(invokeMock).toHaveBeenCalledWith('set_system_proxy', { enabled: true, port: 2080 });
    expect(chips(app)).toEqual(['System proxy:on']);
  });
});
