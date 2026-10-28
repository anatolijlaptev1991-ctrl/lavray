// Регрессия T-03: оболочка перезапускает ядро на новом порту с новым токеном,
// а UI раньше читал адрес один раз и после этого был мёртв.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coreUrlFromEnv } from './core';
import {
  followShellEndpoint,
  getCoreEndpoint,
  setCoreEndpoint,
  subscribeCoreEndpoint,
} from './coreEndpoint';

type Handler = (event: { payload: { url: string; token: string } }) => void;

const shell = vi.hoisted(() => ({
  handler: undefined as undefined | Handler,
  release: undefined as undefined | (() => void),
  slow: false,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (_name: string, handler: Handler): Promise<() => void> => {
    shell.handler = handler;
    return Promise.resolve((): void => undefined);
  },
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (): Promise<[string, string]> => {
    if (shell.slow) {
      await new Promise<void>((resolve) => {
        shell.release = resolve;
      });
    }
    return ['127.0.0.1:50001', 'tokenA'];
  },
}));

beforeEach(() => {
  setCoreEndpoint('', '');
  shell.handler = undefined;
  shell.release = undefined;
  shell.slow = false;
});

describe('адрес ядра от оболочки', () => {
  it('подписчики узнают о смене адреса и токена; пустой адрес — ядра нет', () => {
    const seen: string[] = [];
    const off = subscribeCoreEndpoint(() => {
      seen.push(`${getCoreEndpoint().url} ${getCoreEndpoint().token}`);
    });
    setCoreEndpoint('tcp://127.0.0.1:50001', 'tokenA');
    setCoreEndpoint('tcp://127.0.0.1:50001', 'tokenA'); // тот же адрес — без уведомления
    setCoreEndpoint('tcp://127.0.0.1:50002', 'tokenB');
    off();
    expect(seen).toEqual(['http://127.0.0.1:50001 tokenA', 'http://127.0.0.1:50002 tokenB']);

    setCoreEndpoint('', ''); // ядро умерло
    expect(window.__LAVRAY_CORE_TOKEN).toBeUndefined();
    expect(getCoreEndpoint()).toEqual({ url: coreUrlFromEnv(), token: '' });
  });

  it('берёт адрес у команды, затем идёт за событиями; поздний ответ команды не откатывает адрес', async () => {
    await followShellEndpoint();
    expect(getCoreEndpoint()).toEqual({ url: 'http://127.0.0.1:50001', token: 'tokenA' });
    shell.handler?.({ payload: { url: 'tcp://127.0.0.1:50002', token: 'tokenB' } });
    expect(getCoreEndpoint().token).toBe('tokenB');

    shell.slow = true; // команда ответит уже после события
    const done = followShellEndpoint();
    await vi.waitFor(() => {
      expect(shell.release).toBeDefined();
    });
    shell.handler?.({ payload: { url: 'tcp://127.0.0.1:50003', token: 'tokenC' } });
    shell.release?.();
    await done;
    expect(getCoreEndpoint()).toEqual({ url: 'http://127.0.0.1:50003', token: 'tokenC' });
  });
});
