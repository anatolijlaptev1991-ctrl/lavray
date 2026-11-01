// SPDX-License-Identifier: GPL-3.0-only

// pickFolder.test.ts — T-78: «Выбрать папку…» зовёт команду оболочки; отмена —
// null, а не ошибка; вне окна приложения (веб-панель, тесты) — null без вызова.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickFolder } from './pickFolder';

const invokeMock = vi.hoisted(() => vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  delete (window as TauriWindow).__TAURI_INTERNALS__;
});

describe('pickFolder (T-78)', () => {
  it('returns_the_path_chosen_in_the_shell_dialog', async () => {
    (window as TauriWindow).__TAURI_INTERNALS__ = {};
    invokeMock.mockResolvedValue('C:/Users/Анна/nekoray/config');
    await expect(pickFolder()).resolves.toBe('C:/Users/Анна/nekoray/config');
    expect(invokeMock).toHaveBeenCalledWith('file_pick_folder');
  });

  it('cancel_is_null', async () => {
    (window as TauriWindow).__TAURI_INTERNALS__ = {};
    invokeMock.mockResolvedValue(null);
    await expect(pickFolder()).resolves.toBeNull();
  });

  it('empty_answer_is_null', async () => {
    (window as TauriWindow).__TAURI_INTERNALS__ = {};
    invokeMock.mockResolvedValue('');
    await expect(pickFolder()).resolves.toBeNull();
  });

  it('outside_the_app_window_is_null_without_a_call', async () => {
    await expect(pickFolder()).resolves.toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('shell_failure_is_an_error_with_its_code', async () => {
    (window as TauriWindow).__TAURI_INTERNALS__ = {};
    invokeMock.mockRejectedValue('join error');
    await expect(pickFolder()).rejects.toThrow('join error');
  });
});
