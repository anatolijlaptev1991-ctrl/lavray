// SPDX-License-Identifier: GPL-3.0-only

// coreRestart.test.ts — перезапуск ядра командой оболочки и ожидание нового адреса.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCoreRestarting, restartCoreAndWait } from './coreRestart';
import { setCoreEndpoint } from './coreEndpoint';

const shell = vi.hoisted(() => ({ invoke: vi.fn<(cmd: string) => Promise<unknown>>() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }));

beforeEach(() => {
  shell.invoke.mockReset();
  setCoreEndpoint('tcp://127.0.0.1:1', 'old');
});
afterEach(() => {
  setCoreEndpoint('', '');
});

describe('restartCoreAndWait', () => {
  it('вызывает restart_core и ждёт новый непустой адрес', async () => {
    shell.invoke.mockImplementation(() => {
      setTimeout(() => {
        setCoreEndpoint('', '');
        setCoreEndpoint('tcp://127.0.0.1:2', 'new');
      }, 5);
      return Promise.resolve(null);
    });
    await restartCoreAndWait(1000);
    expect(shell.invoke).toHaveBeenCalledWith('restart_core');
    expect(window.__LAVRAY_CORE_TOKEN).toBe('new');
  });

  it('пустой core-endpoint («ядра нет») — не готовность; флаг «идёт перезапуск» стоит до нового адреса и снимается после', async () => {
    shell.invoke.mockImplementation(() => {
      setTimeout(() => {
        setCoreEndpoint('', '');
      }, 5);
      setTimeout(() => {
        setCoreEndpoint('tcp://127.0.0.1:2', 'new');
      }, 60);
      return Promise.resolve(null);
    });
    const done = restartCoreAndWait(1000);
    expect(isCoreRestarting()).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(isCoreRestarting()).toBe(true);
    await done;
    expect(isCoreRestarting()).toBe(false);
    expect(window.__LAVRAY_CORE_TOKEN).toBe('new');
  });

  it('таймаут снимает флаг: дальше ошибка ядра обычная', async () => {
    shell.invoke.mockResolvedValue(null);
    await expect(restartCoreAndWait(20)).rejects.toThrow('core_restart_timeout');
    expect(isCoreRestarting()).toBe(false);
  });

  it('не дожидается — ошибка core_restart_timeout', async () => {
    shell.invoke.mockResolvedValue(null);
    await expect(restartCoreAndWait(30)).rejects.toThrow('core_restart_timeout');
  });

  it('ошибка команды пробрасывается', async () => {
    shell.invoke.mockRejectedValue('boom');
    await expect(restartCoreAndWait(30)).rejects.toBe('boom');
  });
});
