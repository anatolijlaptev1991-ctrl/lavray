// SPDX-License-Identifier: GPL-3.0-only

// coreAuth.test.ts — режимы авторизации клиента ядра (T-76): bearer и cookie+CSRF.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoreClients } from './core';
import { CSRF_HEADER, onSessionExpired } from './coreAuth';

type FetchCall = [RequestInfo | URL, RequestInit | undefined];

function stubFetch(status = 200, body: unknown = {}): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
    ),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

const lastCall = (fn: ReturnType<typeof vi.fn>): { init: RequestInit | undefined; headers: Headers } => {
  const [, init] = fn.mock.calls[fn.mock.calls.length - 1] as FetchCall;
  return { init, headers: new Headers(init?.headers) };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('режим cookie (веб-панель)', () => {
  it('csrf_header_on_mutations: каждый вызов несёт CSRF-заголовок и credentials: include', async () => {
    const fetchMock = stubFetch();
    const clients = createCoreClients('https://192.168.1.1:8443', { mode: 'cookie', csrf: () => 'csrf-abc' });
    await clients.core.disconnect({});
    const { init, headers } = lastCall(fetchMock);
    expect(headers.get(CSRF_HEADER)).toBe('csrf-abc');
    expect(init?.credentials).toBe('include');
    expect(headers.get('Authorization')).toBeNull();
    // Любой другой изменяющий вызов — тоже.
    await clients.profiles.deleteProfile({ ids: [1n] });
    expect(lastCall(fetchMock).headers.get(CSRF_HEADER)).toBe('csrf-abc');
  });

  it('CSRF-токен берётся при каждом вызове: после входа и смены сессии он новый', async () => {
    const fetchMock = stubFetch();
    let token = '';
    const clients = createCoreClients('https://r', { mode: 'cookie', csrf: () => token });
    await clients.core.getStatus({});
    expect(lastCall(fetchMock).headers.get(CSRF_HEADER)).toBeNull();
    token = 'after-login';
    await clients.core.getStatus({});
    expect(lastCall(fetchMock).headers.get(CSRF_HEADER)).toBe('after-login');
  });

  it('Unauthenticated от ядра сообщает «сессия истекла», но не для самих методов входа', async () => {
    stubFetch(401, { code: 'unauthenticated', message: 'требуется вход' });
    const clients = createCoreClients('https://r', { mode: 'cookie', csrf: () => 'x' });
    const expired = vi.fn();
    const off = onSessionExpired(expired);
    await expect(clients.core.getStatus({})).rejects.toMatchObject({ code: 16 });
    expect(expired).toHaveBeenCalledTimes(1);
    await expect(clients.web.login({ username: 'a', password: 'b' })).rejects.toMatchObject({ code: 16 });
    expect(expired).toHaveBeenCalledTimes(1); // неверный пароль — не истёкшая сессия
    off();
    await expect(clients.core.getStatus({})).rejects.toBeDefined();
    expect(expired).toHaveBeenCalledTimes(1); // отписка работает
  });
});

describe('режим bearer (оболочка, headless)', () => {
  it('шлёт Authorization и не трогает CSRF и credentials', async () => {
    const fetchMock = stubFetch();
    const clients = createCoreClients('http://127.0.0.1:1', { token: 'tok-42' });
    await clients.core.getStatus({});
    const { init, headers } = lastCall(fetchMock);
    expect(headers.get('Authorization')).toBe('Bearer tok-42');
    expect(headers.get(CSRF_HEADER)).toBeNull();
    expect(init?.credentials).not.toBe('include');
  });

  it('без токена и режима заголовков авторизации нет', async () => {
    const fetchMock = stubFetch();
    await createCoreClients('http://127.0.0.1:1').core.getStatus({});
    expect(lastCall(fetchMock).headers.get('Authorization')).toBeNull();
  });
});
