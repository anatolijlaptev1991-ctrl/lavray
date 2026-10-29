// SPDX-License-Identifier: GPL-3.0-only

// launch.test.ts — T-81 (ревью): признак перезапуска от администратора приходит
// от оболочки (флаг --elevated-relaunch), а не из localStorage старого профиля.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLaunchInfo, takeRelaunched } from './launch';

const invokeMock = vi.hoisted(() => vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
}

beforeEach(() => {
  invokeMock.mockReset();
  (window as TauriWindow).__TAURI_INTERNALS__ = {};
  takeRelaunched(); // сбросить состояние модуля
});

afterEach(() => {
  delete (window as TauriWindow).__TAURI_INTERNALS__;
});

describe('loadLaunchInfo', () => {
  it('признак перезапуска выдаётся один раз', async () => {
    invokeMock.mockResolvedValue({ elevated_relaunch: true });

    await loadLaunchInfo();

    expect(invokeMock).toHaveBeenCalledWith('launch_info');
    expect(takeRelaunched()).toBe(true);
    expect(takeRelaunched()).toBe(false);
  });

  it('обычный запуск, мусорный ответ и сбой команды признака не дают', async () => {
    for (const answer of [{ elevated_relaunch: false }, null, undefined, 'x', 42, {}]) {
      invokeMock.mockResolvedValue(answer);
      await loadLaunchInfo();
      expect(takeRelaunched()).toBe(false);
    }
    invokeMock.mockRejectedValue(new Error('нет команды'));
    await expect(loadLaunchInfo()).resolves.toBeUndefined();
    expect(takeRelaunched()).toBe(false);
  });

  it('вне оболочки оболочку не спрашивают', async () => {
    delete (window as TauriWindow).__TAURI_INTERNALS__;
    await loadLaunchInfo();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(takeRelaunched()).toBe(false);
  });
});
