// App.connection.test.tsx — горячие клавиши и статус-бар настоящего приложения.
// App сам создаёт клиентов, поэтому ядро подменено на уровне fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import App from './App';
import { setLanguage } from './lib/i18n';
import {
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

afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
  delete (window as TauriWindow).__TAURI_INTERNALS__;
});

const ctrl = (key: string): Promise<void> =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true }));
    await Promise.resolve();
  });

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
