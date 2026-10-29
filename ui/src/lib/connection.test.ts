// SPDX-License-Identifier: GPL-3.0-only

// connection.test.ts — выбор сервера, порядок меню и перезапуск соединения.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { ProfileSchema } from '../gen/lavray_pb';
import type { Profile } from '../gen/lavray_pb';
import {
  Down,
  Failure,
  idleStatus,
  profile,
  profileList,
  stubCore,
} from '../test-utils/coreStub';
import { createCoreClients } from './core';
import { onTunDialogRequest, requestTunDialog, takeTunDialogRequest } from './tunRequest';
import {
  chooseProfile,
  loadModes,
  loadSelectedProfileId,
  modesFromRemembered,
  reconnect,
  rememberModes,
  rememberedModes,
  restoreModes,
  saveModes,
  saveSelectedProfileId,
  sortByLatency,
  toggleConnection,
} from './connection';

const invokeMock = vi.hoisted(() => vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
}

const clients = (): ReturnType<typeof createCoreClients> => createCoreClients('http://127.0.0.1:1');

function pb(id: bigint, latencyMs?: number): Profile {
  return create(ProfileSchema, {
    id,
    ...(latencyMs === undefined ? {} : { testResult: { latencyMs } }),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as TauriWindow).__TAURI_INTERNALS__;
});

describe('выбранный сервер', () => {
  it('loadSelectedProfileId: пусто и мусор дают null, число — bigint', () => {
    expect(loadSelectedProfileId(window.localStorage)).toBeNull();
    for (const bad of ['', '0', '-3', '1.5', 'abc', '12abc', '99999999999999999999']) {
      window.localStorage.setItem('lavray.server', bad);
      expect(loadSelectedProfileId(window.localStorage), bad).toBeNull();
    }
    saveSelectedProfileId(window.localStorage, 2147483000n);
    expect(loadSelectedProfileId(window.localStorage)).toBe(2147483000n);
  });

  it('chooseProfile: выбранный, пока он есть в списке; иначе первый; пустой список — undefined', () => {
    const list = [pb(1n), pb(2n), pb(3n)];
    expect(chooseProfile(list, 2n)?.id).toBe(2n);
    expect(chooseProfile(list, 99n)?.id).toBe(1n);
    expect(chooseProfile(list, null)?.id).toBe(1n);
    expect(chooseProfile([], 2n)).toBeUndefined();
  });

  it('sortByLatency: по возрастанию; без замера (0) и недоступные (<0) — в конце, порядок списка сохраняется', () => {
    const list = [pb(1n, 120), pb(2n), pb(3n, 35), pb(4n, -1), pb(5n, 35)];
    expect(sortByLatency(list).map((p) => p.id)).toEqual([3n, 5n, 1n, 2n, 4n]);
    expect(list.map((p) => p.id)).toEqual([1n, 2n, 3n, 4n, 5n]); // исходный список не тронут
  });
});

describe('toggleConnection (Ctrl+D и меню титлбара)', () => {
  const routes = {
    'CoreService/GetStatus': idleStatus(),
    'ProfileService/ListProfiles': profileList(profile('1', 'S1'), profile('2', 'S2')),
  };

  it('подключает сервер, выбранный на экране «Подключение», а не первый в списке', async () => {
    saveModes(window.localStorage, { sysProxy: false, tunMode: false });
    saveSelectedProfileId(window.localStorage, 2n);
    const core = stubCore(routes);

    expect(await toggleConnection({ core: clients(), connected: false, port: 2080 })).toBe(true);

    expect(core.bodies('CoreService/Connect')).toEqual([
      { profileId: '2', mode: 'CONNECT_MODE_SYSTEM_PROXY' },
    ]);
  });

  it('выбора не было или сервер удалён — подключает первый; серверов нет — false', async () => {
    saveModes(window.localStorage, { sysProxy: false, tunMode: false });
    const core = stubCore(routes);
    await toggleConnection({ core: clients(), connected: false, port: 2080 });
    saveSelectedProfileId(window.localStorage, 99n);
    await toggleConnection({ core: clients(), connected: false, port: 2080 });
    expect(core.bodies('CoreService/Connect').map((b) => (b as { profileId: string }).profileId)).toEqual([
      '1',
      '1',
    ]);

    const empty = stubCore({ ...routes, 'ProfileService/ListProfiles': profileList() });
    expect(await toggleConnection({ core: clients(), connected: false, port: 2080 })).toBe(false);
    expect(empty.bodies('CoreService/Connect')).toEqual([]);
  });
});

describe('toggleConnection: TUN без прав администратора (T-81, ревью)', () => {
  const routes = {
    'CoreService/GetStatus': idleStatus(),
    'ProfileService/ListProfiles': profileList(profile('1', 'S1')),
  };

  beforeEach(() => {
    (window as TauriWindow).__TAURI_INTERNALS__ = {};
    invokeMock.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'is_elevated' ? false : undefined),
    );
  });

  it('трей и Ctrl+D: показывают окно и просят диалог TUN, а не подключаются', async () => {
    saveModes(window.localStorage, { sysProxy: false, tunMode: true });
    const core = stubCore(routes);
    takeTunDialogRequest(); // сбросить следы других тестов

    expect(await toggleConnection({ core: clients(), connected: false, port: 2080 })).toBe(false);

    expect(core.bodies('CoreService/Connect')).toEqual([]);
    // окно могло быть скрыто в трей: его нужно показать (вызов уходит асинхронно)
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('window_show');
    });
    expect(takeTunDialogRequest()).toBe(true);
    expect(takeTunDialogRequest()).toBe(false); // просьба выдаётся один раз
  });

  it('без выбранного TUN, а также при правах просьбы нет', async () => {
    saveModes(window.localStorage, { sysProxy: false, tunMode: false });
    stubCore(routes);
    takeTunDialogRequest();
    expect(await toggleConnection({ core: clients(), connected: false, port: 2080 })).toBe(true);
    expect(takeTunDialogRequest()).toBe(false);

    saveModes(window.localStorage, { sysProxy: false, tunMode: true });
    invokeMock.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'is_elevated' ? true : undefined),
    );
    stubCore(routes);
    expect(await toggleConnection({ core: clients(), connected: false, port: 2080 })).toBe(true);
    expect(takeTunDialogRequest()).toBe(false);
  });

  it('просьба, пришедшая до открытия экрана, ждёт его; подписчик получает новую сразу', () => {
    takeTunDialogRequest();
    requestTunDialog();
    const seen: boolean[] = [];
    const stop = onTunDialogRequest(() => {
      seen.push(takeTunDialogRequest());
    });
    expect(takeTunDialogRequest()).toBe(true); // экран монтируется и забирает просьбу
    requestTunDialog();
    expect(seen).toEqual([true]);
    stop();
    requestTunDialog();
    expect(seen).toEqual([true]);
    takeTunDialogRequest();
  });
});

describe('reconnect', () => {
  const sys = { sysProxy: true, tunMode: false };
  const tun = { sysProxy: true, tunMode: true };

  it('Disconnect, затем Connect с новым профилем и режимом', async () => {
    const core = stubCore({});
    await reconnect({
      core: clients(),
      next: { profileId: 2n, modes: tun },
      prev: { profileId: 1n, modes: sys },
    });

    expect(core.calls.map((c) => c.rpc)).toEqual(['CoreService/Disconnect', 'CoreService/Connect']);
    expect(core.bodies('CoreService/Connect')).toEqual([{ profileId: '2', mode: 'CONNECT_MODE_TUN' }]);
  });

  it('новый запуск не удался: возвращает прежний и пробрасывает исходную ошибку', async () => {
    const core = stubCore({
      'CoreService/Connect': (n) => (n === 0 ? new Failure('internal', 'tun: access is denied') : {}),
    });

    await expect(
      reconnect({ core: clients(), next: { profileId: 1n, modes: tun }, prev: { profileId: 1n, modes: sys } }),
    ).rejects.toThrow('tun: access is denied');

    expect(core.bodies('CoreService/Connect')).toEqual([
      { profileId: '1', mode: 'CONNECT_MODE_TUN' },
      { profileId: '1', mode: 'CONNECT_MODE_SYSTEM_PROXY' },
    ]);
    expect(invokeMock).not.toHaveBeenCalled(); // откат удался — прокси ОС не трогали
  });

  it('не удался и откат, либо упал Disconnect: системный прокси снимается', async () => {
    (window as TauriWindow).__TAURI_INTERNALS__ = {};
    const next = { profileId: 2n, modes: sys };
    const prev = { profileId: 1n, modes: sys };

    stubCore({ 'CoreService/Connect': new Failure('internal', 'boom') });
    await expect(reconnect({ core: clients(), next, prev })).rejects.toThrow('boom');
    expect(invokeMock).toHaveBeenCalledWith('set_system_proxy', expect.objectContaining({ enabled: false }));

    invokeMock.mockClear();
    const dead = stubCore({ 'CoreService/Disconnect': new Down() });
    await expect(reconnect({ core: clients(), next, prev })).rejects.toThrow('Failed to fetch');
    expect(dead.bodies('CoreService/Connect')).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith('set_system_proxy', expect.objectContaining({ enabled: false }));
  });
});

describe('режимы в настройке ядра remember.modes (T-81)', () => {
  it('rememberedModes и modesFromRemembered — взаимно обратные', () => {
    expect(rememberedModes({ sysProxy: true, tunMode: true })).toEqual(['tun', 'system_proxy']);
    expect(rememberedModes({ sysProxy: false, tunMode: true })).toEqual(['tun']);
    expect(rememberedModes({ sysProxy: false, tunMode: false })).toEqual([]);
    for (const modes of [
      { sysProxy: true, tunMode: true },
      { sysProxy: false, tunMode: true },
      { sysProxy: true, tunMode: false },
    ]) {
      expect(modesFromRemembered(rememberedModes(modes))).toEqual(modes);
    }
    // имена NekoBox и мусор
    expect(modesFromRemembered(['vpn', ' proxy '])).toEqual({ sysProxy: true, tunMode: true });
    expect(modesFromRemembered([])).toBeNull();
    expect(modesFromRemembered(['что-то'])).toBeNull();
  });

  it('rememberModes пишет список в SetSettings; ядро недоступно — без ошибки', async () => {
    const core = stubCore({ 'SettingsService/SetSettings': { acceptedKeys: ['remember.modes'] } });
    await rememberModes(clients(), { sysProxy: false, tunMode: true });
    expect(core.bodies('SettingsService/SetSettings')).toEqual([
      { values: { 'remember.modes': { stringListValue: { items: ['tun'] } } } },
    ]);

    stubCore({ 'SettingsService/SetSettings': new Down() });
    await expect(rememberModes(clients(), { sysProxy: true, tunMode: false })).resolves.toBeUndefined();
  });

  it('restoreModes берёт режимы из ядра, только если в окне выбора нет', async () => {
    const reply = {
      'SettingsService/GetSettings': {
        values: { 'remember.modes': { stringListValue: { items: ['tun'] } } },
      },
    };
    const core = stubCore(reply);
    expect(await restoreModes(clients(), window.localStorage)).toEqual({ sysProxy: false, tunMode: true });
    expect(loadModes(window.localStorage)).toEqual({ sysProxy: false, tunMode: true });
    expect(core.bodies('SettingsService/GetSettings')).toEqual([{ keys: ['remember.modes'] }]);

    // собственный выбор окна не затирается, ядро даже не спрашивается
    saveModes(window.localStorage, { sysProxy: true, tunMode: false });
    const second = stubCore(reply);
    expect(await restoreModes(clients(), window.localStorage)).toBeNull();
    expect(second.calls).toEqual([]);
    expect(loadModes(window.localStorage)).toEqual({ sysProxy: true, tunMode: false });
  });

  it('restoreModes: ядро ничего не помнит или недоступно — null, localStorage пуст', async () => {
    stubCore({ 'SettingsService/GetSettings': { values: {} } });
    expect(await restoreModes(clients(), window.localStorage)).toBeNull();
    stubCore({ 'SettingsService/GetSettings': new Down() });
    expect(await restoreModes(clients(), window.localStorage)).toBeNull();
    expect(window.localStorage.getItem('lavray.modes')).toBeNull();
  });
});
