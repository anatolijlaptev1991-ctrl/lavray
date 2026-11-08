// SPDX-License-Identifier: GPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PENDING_CONNECT_KEY } from './pendingConnect';
import { relaunchForTun } from './tunRelaunch';

const h = vi.hoisted(() => ({
  relaunch: vi.fn<() => Promise<string>>(),
  order: [] as string[],
}));
vi.mock('./elevation', () => ({
  relaunchElevated: (): Promise<string> => {
    h.order.push('relaunch');
    return h.relaunch();
  },
}));
vi.mock('./uiState', () => ({
  saveUiStateNow: (): Promise<void> => {
    h.order.push('flush');
    return Promise.resolve();
  },
}));

const core = { settings: { setSettings: vi.fn().mockResolvedValue({}) } } as never;
const prev = { sysProxy: true, tunMode: false };

describe('relaunchForTun', () => {
  beforeEach(() => {
    window.localStorage.clear();
    h.order.length = 0;
    h.relaunch.mockReset().mockResolvedValue('started');
  });

  it('до перезапуска записывает TUN и намерение подключиться, затем сбрасывает файл', async () => {
    await expect(relaunchForTun({ core, prev, profileId: 9n })).resolves.toBe('started');
    expect(h.order).toEqual(['flush', 'relaunch']);
    const intent = JSON.parse(window.localStorage.getItem(PENDING_CONNECT_KEY) ?? 'null') as Record<string, unknown>;
    expect(intent).toMatchObject({ profileId: '9', mode: 'tun' });
    expect(JSON.parse(window.localStorage.getItem('lavray.modes') ?? '{}')).toEqual({ sysProxy: true, tunMode: true });
  });

  it('без выбранного сервера намерения нет', async () => {
    await relaunchForTun({ core, prev, profileId: undefined });
    expect(window.localStorage.getItem(PENDING_CONNECT_KEY)).toBeNull();
  });

  it('отказ в UAC возвращает режимы и снимает намерение', async () => {
    h.relaunch.mockResolvedValue('cancelled');
    await expect(relaunchForTun({ core, prev, profileId: 9n })).resolves.toBe('cancelled');
    expect(window.localStorage.getItem(PENDING_CONNECT_KEY)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('lavray.modes') ?? '{}')).toEqual(prev);
  });

  it('сбой перезапуска тоже снимает намерение и пробрасывает ошибку', async () => {
    h.relaunch.mockRejectedValue(new Error('unsupported'));
    await expect(relaunchForTun({ core, prev, profileId: 9n })).rejects.toThrow('unsupported');
    expect(window.localStorage.getItem(PENDING_CONNECT_KEY)).toBeNull();
  });
});
