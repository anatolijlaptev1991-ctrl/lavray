// SPDX-License-Identifier: GPL-3.0-only

// proxyRelease.test.ts — автоматическое снятие прокси окном спрашивает оболочку:
// пока она говорит «оставлен», окно прокси не трогает.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applySystemProxy, isSystemProxyApplied, markSystemProxy } from './connection';
import { clearProxyKept, isProxyKept, markProxyKept, queryProxyKept } from './killSwitch';
import { releaseUnlessKept } from './proxyRelease';

interface Shell {
  /** Что отвечает оболочка на `proxy_kept` (не-boolean проверяет строгий `=== true`). */
  answer: boolean | string;
  invoke: ReturnType<typeof vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>>;
}
const shell = vi.hoisted<Shell>(() => ({
  answer: false,
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }));

const releases = (): unknown[] =>
  shell.invoke.mock.calls.filter(([cmd, a]) => cmd === 'set_system_proxy' && !(a as { enabled: boolean }).enabled);

beforeEach(async () => {
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  shell.answer = false;
  shell.invoke.mockReset().mockImplementation((cmd) => Promise.resolve(cmd === 'proxy_kept' ? shell.answer : ''));
  clearProxyKept();
  await applySystemProxy(true, 2080);
  shell.invoke.mockClear();
});

afterEach(() => {
  clearProxyKept();
  markSystemProxy(false);
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe('queryProxyKept', () => {
  it('отвечает значением оболочки; всё, кроме true, — false', async () => {
    shell.answer = true;
    expect(await queryProxyKept()).toBe(true);
    shell.answer = 'true';
    expect(await queryProxyKept()).toBe(false);
    shell.answer = false;
    expect(await queryProxyKept()).toBe(false);
  });

  it('сбой команды — false, не исключение', async () => {
    shell.invoke.mockRejectedValue(new Error('command not found'));
    expect(await queryProxyKept()).toBe(false);
  });

  it('вне окна приложения оболочку не спрашивает', async () => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    expect(await queryProxyKept()).toBe(false);
    expect(shell.invoke).not.toHaveBeenCalled();
  });
});

describe('releaseUnlessKept', () => {
  it('оболочка говорит «оставлен» — прокси не снимается, флаг ставится', async () => {
    shell.answer = true;
    expect(await releaseUnlessKept()).toBe(false);
    expect(releases()).toEqual([]);
    expect(isSystemProxyApplied()).toBe(true);
    expect(isProxyKept()).toBe(true);
  });

  it('флаг окна уже стоит — оболочку не спрашивает и прокси не снимает', async () => {
    markProxyKept();
    expect(await releaseUnlessKept()).toBe(false);
    expect(shell.invoke.mock.calls.some(([c]) => c === 'proxy_kept')).toBe(false);
    expect(releases()).toEqual([]);
  });

  it('не оставлен — прокси снимается обычным путём', async () => {
    expect(await releaseUnlessKept()).toBe(true);
    expect(releases()).toHaveLength(1);
    expect(isSystemProxyApplied()).toBe(false);
  });
});
