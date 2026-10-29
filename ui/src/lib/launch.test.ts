// SPDX-License-Identifier: GPL-3.0-only

// launch.test.ts — T-81 (ревью): признак перезапуска от администратора и
// записи окна приходят от оболочки, а не из localStorage старого профиля.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLaunchInfo, sendHandoff, takeRelaunched } from './launch';

const invokeMock = vi.hoisted(() => vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
}

beforeEach(() => {
  window.localStorage.clear();
  invokeMock.mockReset();
  (window as TauriWindow).__TAURI_INTERNALS__ = {};
  takeRelaunched(); // сбросить состояние модуля
});

afterEach(() => {
  delete (window as TauriWindow).__TAURI_INTERNALS__;
});

describe('applyLaunchInfo', () => {
  it('записи оболочки попадают в хранилище, признак перезапуска выдаётся один раз', async () => {
    invokeMock.mockResolvedValue({
      elevated_relaunch: true,
      handoff: { 'lavray.lang': 'de', 'lavray.modes': '{"sysProxy":false,"tunMode":true}' },
    });

    await applyLaunchInfo(window.localStorage);

    expect(invokeMock).toHaveBeenCalledWith('launch_info');
    expect(window.localStorage.getItem('lavray.lang')).toBe('de');
    expect(window.localStorage.getItem('lavray.modes')).toBe('{"sysProxy":false,"tunMode":true}');
    expect(takeRelaunched()).toBe(true);
    expect(takeRelaunched()).toBe(false);
  });

  it('чужие ключи и не-строки отбрасываются, мусорный ответ ничего не ломает', async () => {
    invokeMock.mockResolvedValue({
      elevated_relaunch: false,
      handoff: { 'lavray.theme': 'dark', token: 'x', 'lavray.n': 5 },
    });
    await applyLaunchInfo(window.localStorage);
    expect(window.localStorage.getItem('lavray.theme')).toBe('dark');
    expect(window.localStorage.getItem('token')).toBeNull();
    expect(window.localStorage.getItem('lavray.n')).toBeNull();
    expect(window.localStorage.length).toBe(1);
    expect(takeRelaunched()).toBe(false);

    for (const garbage of [null, undefined, 'x', 42, { handoff: 'x' }, { handoff: null }]) {
      invokeMock.mockResolvedValue(garbage);
      await expect(applyLaunchInfo(window.localStorage)).resolves.toBeUndefined();
    }
    expect(window.localStorage.length).toBe(1);
  });

  it('сбой команды и работа вне оболочки: окно стартует со своими настройками', async () => {
    invokeMock.mockRejectedValue(new Error('нет команды'));
    await expect(applyLaunchInfo(window.localStorage)).resolves.toBeUndefined();
    expect(takeRelaunched()).toBe(false);

    delete (window as TauriWindow).__TAURI_INTERNALS__;
    invokeMock.mockReset();
    await applyLaunchInfo(window.localStorage);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('sendHandoff', () => {
  it('передаёт оболочке только записи lavray.*', async () => {
    window.localStorage.setItem('lavray.lang', 'ru');
    window.localStorage.setItem('lavray.onboarded', '1');
    window.localStorage.setItem('other.key', 'secret');
    invokeMock.mockResolvedValue(undefined);

    await sendHandoff(window.localStorage);

    expect(invokeMock).toHaveBeenCalledWith('save_ui_handoff', {
      entries: { 'lavray.lang': 'ru', 'lavray.onboarded': '1' },
    });
  });

  it('сбой оболочки не мешает перезапуску; вне оболочки ничего не отправляется', async () => {
    window.localStorage.setItem('lavray.lang', 'ru');
    invokeMock.mockRejectedValue('диск полон');
    await expect(sendHandoff(window.localStorage)).resolves.toBeUndefined();

    delete (window as TauriWindow).__TAURI_INTERNALS__;
    invokeMock.mockReset();
    await sendHandoff(window.localStorage);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
