// SPDX-License-Identifier: GPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HOTKEY_EVENT,
  accelFromKeyEvent,
  hotkeyErrorKey,
  listenGlobalHotkey,
  setGlobalHotkey,
  suspendGlobalHotkey,
} from './globalHotkey';

vi.mock('@tauri-apps/api/core', async () => (await import('../test-utils/tauriStub')).tauriCoreModule);
vi.mock('@tauri-apps/api/event', async () => (await import('../test-utils/tauriStub')).tauriEventModule);
const { tauri, enableTauri, disableTauri } = await import('../test-utils/tauriStub');

type Mods = Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>>;
type KeyLike = Parameters<typeof accelFromKeyEvent>[0];

const key = (code: string, mods: Mods = {}): KeyLike => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

beforeEach(() => {
  tauri.reset();
  enableTauri();
});

afterEach(() => {
  suspendGlobalHotkey(false);
  disableTauri();
});

describe('accelFromKeyEvent', () => {
  it('builds_normal_form_from_physical_keys', () => {
    expect(accelFromKeyEvent(key('KeyK', { ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+K');
    expect(accelFromKeyEvent(key('Digit1', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+1');
    expect(accelFromKeyEvent(key('F5', { altKey: true }))).toBe('Alt+F5');
    expect(accelFromKeyEvent(key('KeyK', { metaKey: true }))).toBe('Win+K');
  });

  it('modifier_alone_waits', () => {
    for (const code of ['ControlLeft', 'AltRight', 'ShiftLeft', 'MetaLeft', 'OSLeft', '']) {
      expect(accelFromKeyEvent(key(code, { ctrlKey: true }))).toBeNull();
    }
  });

  it('other_keys_pass_through_for_the_shell_to_reject', () => {
    expect(accelFromKeyEvent(key('Space', { ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+Space');
    expect(accelFromKeyEvent(key('KeyQ'))).toBe('Q');
  });
});

describe('hotkeyErrorKey', () => {
  it('maps_codes', () => {
    expect(hotkeyErrorKey('no_modifier')).toBe('hk.err.noModifier');
    expect(hotkeyErrorKey('reserved')).toBe('hk.err.reserved');
    expect(hotkeyErrorKey('conflict')).toBe('hk.err.conflict');
    expect(hotkeyErrorKey('invalid_accel')).toBe('hk.err.invalid');
    expect(hotkeyErrorKey('boom')).toBe('hk.err.failed');
  });
});

describe('setGlobalHotkey', () => {
  it('returns_normalized_accel', async () => {
    tauri.onValue('hotkey_set', 'Ctrl+Alt+K');
    await expect(setGlobalHotkey('alt+ctrl+k')).resolves.toBe('Ctrl+Alt+K');
    expect(tauri.argsOf('hotkey_set')).toEqual([{ accel: 'alt+ctrl+k' }]);
  });

  it('clear_returns_null', async () => {
    tauri.onValue('hotkey_set', null);
    await expect(setGlobalHotkey(null)).resolves.toBeNull();
    expect(tauri.argsOf('hotkey_set')).toEqual([{ accel: null }]);
  });

  it('shell_error_code_is_the_message', async () => {
    tauri.onError('hotkey_set', 'conflict');
    await expect(setGlobalHotkey('Ctrl+Alt+K')).rejects.toThrow('conflict');
  });

  it('unsupported_outside_shell', async () => {
    disableTauri();
    await expect(setGlobalHotkey('Ctrl+Alt+K')).rejects.toThrow('unsupported');
  });
});

describe('listenGlobalHotkey', () => {
  it('fires_and_unsubscribes', async () => {
    const hits = vi.fn();
    const stop = await listenGlobalHotkey(hits);
    tauri.emit(HOTKEY_EVENT);
    expect(hits).toHaveBeenCalledTimes(1);
    stop();
    expect(tauri.listenerCount(HOTKEY_EVENT)).toBe(0);
  });

  it('ignored_while_capturing', async () => {
    const hits = vi.fn();
    await listenGlobalHotkey(hits);
    suspendGlobalHotkey(true);
    tauri.emit(HOTKEY_EVENT);
    suspendGlobalHotkey(false);
    tauri.emit(HOTKEY_EVENT);
    expect(hits).toHaveBeenCalledTimes(1);
  });
});
