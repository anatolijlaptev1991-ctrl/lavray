// screen_connection.test.tsx — регрессионные тесты экрана «Подключение».
// Ядро — заглушка на уровне fetch (test-utils/coreStub.ts), ответы дословные.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { setLanguage } from '../lib/i18n';
import {
  Down,
  click,
  connectedStatus,
  idleStatus,
  mount,
  profile,
  profileList,
  stubCore,
  unmountAll,
} from '../test-utils/coreStub';
import { ConnectionScreen } from './screen_connection';

const invokeMock = vi.hoisted(() => vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
}

const screen = (): Promise<Awaited<ReturnType<typeof mount>>> => mount(createElement(ConnectionScreen));

beforeEach(() => {
  setLanguage('en');
  window.localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
  delete (window as TauriWindow).__TAURI_INTERNALS__;
});

describe('экран «Подключение» в простое (T-04)', () => {
  it('статус простоя без activeProfileId: кнопка «Connect» и два тумблера на месте', async () => {
    const status = idleStatus();
    expect('activeProfileId' in status).toBe(false); // ядро поля не присылает
    stubCore({
      'CoreService/GetStatus': status,
      'ProfileService/ListProfiles': profileList(profile('1', 'S1'), profile('2', 'S2')),
    });
    const view = await screen();

    expect(view.container.querySelector('#cxEmpty')).toBeNull();
    const main = view.container.querySelector<HTMLButtonElement>('#cxMain .btn-lg');
    expect(main?.textContent).toBe('Connect');
    expect(main?.disabled).toBe(false);
    expect(view.container.querySelectorAll('#cxMain [role="switch"]')).toHaveLength(2);
  });

  it('серверов нет: остаётся экран «No servers yet»', async () => {
    stubCore({ 'CoreService/GetStatus': idleStatus(), 'ProfileService/ListProfiles': profileList() });
    const view = await screen();

    expect(view.container.querySelector('#cxMain')).toBeNull();
    expect(view.container.querySelector('#cxEmpty')?.textContent).toContain('No servers yet');
  });

  it('«Connect» запускает первый сервер и ставит прокси ОС', async () => {
    (window as TauriWindow).__TAURI_INTERNALS__ = {};
    const core = stubCore({
      'CoreService/GetStatus': idleStatus(),
      'ProfileService/ListProfiles': profileList(profile('1', 'S1'), profile('2', 'S2')),
    });
    const view = await screen();

    await click(view.container.querySelector('#cxMain .btn-lg'));

    expect(core.bodies('CoreService/Connect')).toEqual([
      { profileId: '1', mode: 'CONNECT_MODE_SYSTEM_PROXY' },
    ]);
    expect(invokeMock).toHaveBeenCalledWith('set_system_proxy', { enabled: true, port: 2080 });
  });

  it('CONNECTED, но профиля нет в списке: кнопка «Disconnect» всё равно показана', async () => {
    stubCore({
      'CoreService/GetStatus': connectedStatus('7', 'Gone'),
      'ProfileService/ListProfiles': profileList(profile('1', 'S1')),
    });
    const view = await screen();

    expect(view.container.querySelector('#cxMain .btn-lg')?.textContent).toBe('Disconnect');
  });

  it('«Disconnect» снимает прокси ОС, даже если RPC Disconnect упал', async () => {
    (window as TauriWindow).__TAURI_INTERNALS__ = {};
    const core = stubCore({
      'CoreService/GetStatus': connectedStatus('1', 'S1'),
      'ProfileService/ListProfiles': profileList(profile('1', 'S1')),
      'CoreService/Disconnect': new Down(),
    });
    const view = await screen();

    await click(view.container.querySelector('#cxMain .btn-lg'));

    expect(core.bodies('CoreService/Disconnect')).toHaveLength(1);
    expect(invokeMock).toHaveBeenCalledWith(
      'set_system_proxy',
      expect.objectContaining({ enabled: false }),
    );
    // Сообщение переведено, а не сырой ключ `core.unavailable`.
    const banner = view.container.querySelector('.banner-err')?.textContent ?? '';
    expect(banner).toContain('Core unavailable');
  });
});
