// SPDX-License-Identifier: GPL-3.0-only

// shellCaps.test.ts — возможности оболочки: запасные значения до ответа
// (веб — всё выключено, Tauri на Windows — как раньше, Tauri на Linux — по UA),
// разбор ответа `shell_capabilities` и устойчивость к его отсутствию.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShellCaps, loadShellCaps, parseShellCaps, resetShellCaps, subscribeShellCaps } from './shellCaps';

const shell = vi.hoisted(() => ({ invoke: vi.fn<(cmd: string) => Promise<unknown>>() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }));

const setUa = (ua: string): void => {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
};
const enableTauri = (): void => {
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
};
const ORIGINAL_UA = window.navigator.userAgent;

beforeEach(() => {
  shell.invoke.mockReset();
  resetShellCaps();
});
afterEach(() => {
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  setUa(ORIGINAL_UA);
  resetShellCaps();
});

describe('запасные значения', () => {
  it('веб без оболочки: всё выключено, команда не вызывается', async () => {
    await loadShellCaps();
    expect(getShellCaps()).toMatchObject({
      os: 'web',
      screenCapture: false,
      selfUpdate: false,
      globalHotkeys: false,
      trayAvailable: false,
      tunAccess: 'admin',
    });
    expect(shell.invoke).not.toHaveBeenCalled();
  });

  it('Tauri на Windows: как до появления команды', () => {
    enableTauri();
    setUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    expect(getShellCaps()).toMatchObject({
      os: 'windows',
      tunAccess: 'admin',
      screenCapture: true,
      selfUpdate: true,
      globalHotkeys: true,
      trayAvailable: true,
    });
  });

  it('Tauri на Linux: права выдаются ядру, снимка экрана и самообновления нет', () => {
    enableTauri();
    setUa('Mozilla/5.0 (X11; Linux x86_64)');
    expect(getShellCaps()).toMatchObject({ os: 'linux', tunAccess: 'grant', screenCapture: false, selfUpdate: false });
  });

  it('снимок стабилен между вызовами (для useSyncExternalStore)', () => {
    enableTauri();
    expect(getShellCaps()).toBe(getShellCaps());
  });
});

describe('loadShellCaps', () => {
  it('берёт ответ оболочки и сообщает подписчикам', async () => {
    enableTauri();
    shell.invoke.mockResolvedValue({
      os: 'linux',
      sessionType: 'wayland',
      packaging: 'deb',
      tunAccess: 'grant',
      screenCapture: false,
      selfUpdate: false,
      globalHotkeys: false,
      trayAvailable: false,
    });
    const listener = vi.fn();
    const off = subscribeShellCaps(listener);
    await loadShellCaps();
    off();
    expect(shell.invoke).toHaveBeenCalledWith('shell_capabilities');
    expect(getShellCaps()).toMatchObject({ os: 'linux', sessionType: 'wayland', globalHotkeys: false, trayAvailable: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('старая оболочка без команды: остаются запасные значения', async () => {
    enableTauri();
    setUa('Mozilla/5.0 (Windows NT 10.0)');
    shell.invoke.mockRejectedValue(new Error('command shell_capabilities not found'));
    await loadShellCaps();
    expect(getShellCaps()).toMatchObject({ os: 'windows', selfUpdate: true });
  });
});

describe('parseShellCaps', () => {
  const base = getShellCaps();
  it('поля неожиданного вида берутся из запасных значений', () => {
    const parsed = parseShellCaps({ os: 'beos', tunAccess: 7, screenCapture: 'yes', selfUpdate: false }, base);
    expect(parsed).toMatchObject({ tunAccess: base.tunAccess, screenCapture: base.screenCapture, selfUpdate: false });
  });
  it('не объект — null', () => {
    expect(parseShellCaps(null, base)).toBeNull();
    expect(parseShellCaps('linux', base)).toBeNull();
  });
});
