// SPDX-License-Identifier: GPL-3.0-only

// webSession.test.ts — чистая логика веб-панели: режим, предупреждение «Не
// защищено», политика пароля, разбор ошибок входа.
import { describe, expect, it } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';
import {
  authFailure,
  getCsrfToken,
  isInsecureTransport,
  isLoopbackHost,
  isWebShell,
  passwordProblem,
  retryAfterSeconds,
  setCsrfToken,
} from './webSession';

const win = (over: Record<string, unknown>, protocol = 'http:'): Window =>
  ({ location: { protocol }, ...over }) as unknown as Window;

describe('isWebShell', () => {
  it('обычный браузер на http(s) — веб-режим', () => {
    expect(isWebShell(win({}))).toBe(true);
    expect(isWebShell(win({}, 'https:'))).toBe(true);
  });
  it('окно Tauri, подмена адреса ядра и токена, не-http — не веб-режим', () => {
    expect(isWebShell(win({ __TAURI_INTERNALS__: {} }))).toBe(false);
    expect(isWebShell(win({ __LAVRAY_CORE_URL: 'http://127.0.0.1:5' }))).toBe(false);
    expect(isWebShell(win({ __LAVRAY_CORE_TOKEN: 'tok' }))).toBe(false);
    expect(isWebShell(win({}, 'file:'))).toBe(false);
  });
});

describe('insecure_banner_on_http (логика)', () => {
  it('HTTP не на loopback — небезопасно', () => {
    expect(isInsecureTransport({ protocol: 'http:', hostname: '192.168.1.1' })).toBe(true);
    expect(isInsecureTransport({ protocol: 'http:', hostname: 'router.lan' })).toBe(true);
  });
  it('HTTPS и loopback — безопасно', () => {
    expect(isInsecureTransport({ protocol: 'https:', hostname: '192.168.1.1' })).toBe(false);
    for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1']) {
      expect(isLoopbackHost(host)).toBe(true);
      expect(isInsecureTransport({ protocol: 'http:', hostname: host })).toBe(false);
    }
    expect(isLoopbackHost('127.0.0.1.evil.example')).toBe(false);
  });
});

describe('политика пароля', () => {
  it('граница в 10 символов, считаются символы а не байты', () => {
    expect(passwordProblem('123456789')).toMatchObject({ key: 'web.setup.short' });
    expect(passwordProblem('1234567890')).toBeNull();
    expect(passwordProblem('пароль-пароль')).toBeNull();
    expect(passwordProblem('')).toMatchObject({ key: 'web.setup.short' });
  });
  it('повтор пароля должен совпасть', () => {
    expect(passwordProblem('1234567890', '1234567891')).toMatchObject({ key: 'web.setup.mismatch' });
    expect(passwordProblem('1234567890', '1234567890')).toBeNull();
  });
});

describe('разбор ошибок входа', () => {
  const fallback = (e: unknown): string => `fallback:${String(e instanceof Error ? e.message : e)}`;

  it('неверные данные — общий текст', () => {
    expect(authFailure(new ConnectError('x', Code.Unauthenticated), fallback)).toEqual({ key: 'web.login.badCreds' });
  });
  it('блокировка берёт паузу из Retry-After', () => {
    const e = new ConnectError('limit', Code.ResourceExhausted, new Headers({ 'Retry-After': '37' }));
    expect(retryAfterSeconds(e)).toBe(37);
    expect(authFailure(e, fallback)).toEqual({ key: 'web.login.wait', params: { n: 37 } });
  });
  it('блокировка без заголовка — 30 с по умолчанию; чужие ошибки — не блокировка', () => {
    expect(retryAfterSeconds(new ConnectError('limit', Code.ResourceExhausted))).toBe(30);
    expect(retryAfterSeconds(new ConnectError('x', Code.Internal))).toBeNull();
    expect(retryAfterSeconds(new Error('x'))).toBeNull();
  });
  it('прочее — текст из fallback', () => {
    expect(authFailure(new Error('boom'), fallback)).toEqual({ text: 'fallback:boom' });
  });
});

describe('CSRF-токен сессии', () => {
  it('хранится в памяти и сбрасывается', () => {
    setCsrfToken('abc');
    expect(getCsrfToken()).toBe('abc');
    setCsrfToken('');
    expect(getCsrfToken()).toBe('');
  });
});
