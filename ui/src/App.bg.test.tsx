// SPDX-License-Identifier: GPL-3.0-only

// App.bg.test.tsx — фон #bgField отражает состояние ядра (data-conn: off/mid/on/err),
// а окно сообщает активность атрибутом html[data-active].
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { warmViews } from './test-harness';
import App from './App';
import { setLanguage } from './lib/i18n';
import {
  connectedStatus,
  connectingStatus,
  errorStatus,
  idleStatus,
  mountBare,
  profile,
  profileList,
  stubCore,
  stubMatchMedia,
  unmountAll,
} from './test-utils/coreStub';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  stubMatchMedia();
  setLanguage('en');
  window.localStorage.clear();
  window.localStorage.setItem('lavray.onboarded', '1');
  window.location.hash = '';
});

afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
});

beforeAll(warmViews, 60_000);

async function bgConn(status: Record<string, unknown>): Promise<string | null | undefined> {
  stubCore({
    'CoreService/GetStatus': status,
    'ProfileService/ListProfiles': profileList(profile('1', 'S1')),
  });
  const app = await mountBare(createElement(App));
  return app.container.querySelector('#bgField')?.getAttribute('data-conn');
}

describe('data-conn фона', () => {
  it('off: ядро не запущено', async () => {
    expect(await bgConn(idleStatus())).toBe('off');
  });
  it('mid: идёт подключение', async () => {
    expect(await bgConn(connectingStatus('1', 'S1'))).toBe('mid');
  });
  it('on: подключено', async () => {
    expect(await bgConn(connectedStatus('1', 'S1'))).toBe('on');
  });
  it('err: ошибка ядра', async () => {
    expect(await bgConn(errorStatus('boom'))).toBe('err');
  });
  it('уже подключённое окно не запускает проход и волну при первом показе', async () => {
    stubCore({
      'CoreService/GetStatus': connectedStatus('1', 'S1'),
      'ProfileService/ListProfiles': profileList(profile('1', 'S1')),
    });
    const app = await mountBare(createElement(App));
    expect(app.container.querySelector('.bf-ripple')).toBeNull();
    expect(app.container.querySelector('.bf-streak.run')).toBeNull();
  });
});

describe('html[data-active]', () => {
  it('выставляется при показе окна', async () => {
    await bgConn(idleStatus());
    expect(['0', '1']).toContain(document.documentElement.dataset.active);
  });
});
