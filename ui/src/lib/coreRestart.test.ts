// SPDX-License-Identifier: GPL-3.0-only

// coreRestart.test.ts — перезапуск ядра командой оболочки и ожидание нового адреса.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restartCoreAndWait } from './coreRestart';
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

  it('не дожидается — ошибка core_restart_timeout', async () => {
    shell.invoke.mockResolvedValue(null);
    await expect(restartCoreAndWait(30)).rejects.toThrow('core_restart_timeout');
  });

  it('ошибка команды пробрасывается', async () => {
    shell.invoke.mockRejectedValue('boom');
    await expect(restartCoreAndWait(30)).rejects.toBe('boom');
  });
});
