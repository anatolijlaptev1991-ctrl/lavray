// SPDX-License-Identifier: GPL-3.0-only

// tunAccess.test.ts — доступ ядра к сети для TUN на Linux и общее решение
// `tunGate`: Windows — по is_elevated (как раньше), Linux — по tun_access_state.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tunGate, tunNeedsElevation } from './elevation';
import { loadShellCaps, resetShellCaps } from './shellCaps';
import { gateFromAccess, grantTunAccess, readTunAccess } from './tunAccess';

const shell = vi.hoisted(() => ({ invoke: vi.fn<(cmd: string) => Promise<unknown>>() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }));

const state = (over: Record<string, unknown>): Record<string, unknown> => ({
  state: 'ready',
  reason: '',
  command: '',
  needsCoreRestart: false,
  ...over,
});

function answers(map: Record<string, unknown>): void {
  shell.invoke.mockImplementation((cmd: string) => {
    if (!(cmd in map)) return Promise.reject(new Error(`no ${cmd}`));
    const value = map[cmd];
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  });
}

beforeEach(() => {
  shell.invoke.mockReset();
  resetShellCaps();
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
});
afterEach(() => {
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  resetShellCaps();
});

describe('readTunAccess', () => {
  it('читает все поля ответа', async () => {
    answers({ tun_access_state: state({ state: 'manual', reason: 'nosuid', command: 'sudo x', needsCoreRestart: true }) });
    expect(await readTunAccess()).toEqual({ state: 'manual', reason: 'nosuid', command: 'sudo x', needsCoreRestart: true });
  });

  it('нет команды, неверный ответ или нет оболочки — null', async () => {
    answers({});
    expect(await readTunAccess()).toBeNull();
    answers({ tun_access_state: { state: 'weird' } });
    expect(await readTunAccess()).toBeNull();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    expect(await readTunAccess()).toBeNull();
  });
});

describe('gateFromAccess', () => {
  it('сопоставляет состояния решениям; неизвестное не блокирует', () => {
    const info = (over: Partial<NonNullable<Parameters<typeof gateFromAccess>[0]>>): Parameters<typeof gateFromAccess>[0] => ({
      state: 'ready',
      reason: '',
      command: '',
      needsCoreRestart: false,
      ...over,
    });
    expect(gateFromAccess(null)).toEqual({ kind: 'ready', restartCore: false });
    expect(gateFromAccess(info({ needsCoreRestart: true }))).toEqual({ kind: 'ready', restartCore: true });
    expect(gateFromAccess(info({ state: 'grantable' }))).toEqual({ kind: 'grant' });
    expect(gateFromAccess(info({ state: 'manual', command: 'c' }))).toEqual({ kind: 'manual', command: 'c' });
    expect(gateFromAccess(info({ state: 'unavailable', reason: 'appimage' }))).toEqual({ kind: 'unavailable', reason: 'appimage' });
  });
});

describe('grantTunAccess', () => {
  it('успех, отмена пароля (не ошибка) и ошибки оболочки', async () => {
    answers({ tun_access_grant: null });
    await expect(grantTunAccess()).resolves.toBe('granted');
    shell.invoke.mockRejectedValue('cancelled');
    await expect(grantTunAccess()).resolves.toBe('cancelled');
    shell.invoke.mockRejectedValue('not_grantable');
    await expect(grantTunAccess()).rejects.toThrow('not_grantable');
    shell.invoke.mockRejectedValue('failed: pkexec exited 126');
    await expect(grantTunAccess()).rejects.toThrow('failed: pkexec exited 126');
  });
});

describe('tunGate', () => {
  it('Windows (admin): решает is_elevated, tun_access_state не вызывается', async () => {
    answers({ shell_capabilities: { os: 'windows', tunAccess: 'admin' }, is_elevated: false });
    await loadShellCaps();
    expect(await tunGate()).toEqual({ kind: 'elevate' });
    expect(await tunNeedsElevation()).toBe(true);
    answers({ shell_capabilities: { os: 'windows', tunAccess: 'admin' }, is_elevated: true });
    expect(await tunGate()).toEqual({ kind: 'ready', restartCore: false });
    expect(shell.invoke.mock.calls.some(([c]) => c === 'tun_access_state')).toBe(false);
  });

  it('Linux (grant): решает tun_access_state, is_elevated не вызывается', async () => {
    answers({
      shell_capabilities: { os: 'linux', tunAccess: 'grant' },
      tun_access_state: state({ state: 'grantable' }),
      is_elevated: false,
    });
    await loadShellCaps();
    expect(await tunGate()).toEqual({ kind: 'grant' });
    expect(await tunNeedsElevation()).toBe(true);
    expect(shell.invoke.mock.calls.some(([c]) => c === 'is_elevated')).toBe(false);
    answers({ shell_capabilities: { os: 'linux', tunAccess: 'grant' }, tun_access_state: state({ needsCoreRestart: true }) });
    expect(await tunGate()).toEqual({ kind: 'ready', restartCore: true });
    expect(await tunNeedsElevation()).toBe(false);
  });

  it('веб без оболочки: не блокирует', async () => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    expect(await tunGate()).toEqual({ kind: 'ready', restartCore: false });
  });
});
