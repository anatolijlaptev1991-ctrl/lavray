// SPDX-License-Identifier: GPL-3.0-only

import { afterEach, describe, expect, it } from 'vitest';
import { UI_STATE_KEYS } from './uiState';
import {
  DEFAULT_SHELL_PREFS,
  SHELL_PREF_KEYS,
  readShellPrefs,
  writeHotkeyConnect,
  writeShellFlag,
} from './shellPrefs';

/** Хранилище, которое бросает на каждом обращении (приватный режим, квота). */
const broken: Storage = {
  get length(): number {
    throw new Error('denied');
  },
  clear: () => {
    throw new Error('denied');
  },
  getItem: () => {
    throw new Error('denied');
  },
  key: () => {
    throw new Error('denied');
  },
  removeItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
};

afterEach(() => {
  window.localStorage.clear();
});

describe('shellPrefs', () => {
  it('defaults_match_the_shell', () => {
    expect(readShellPrefs()).toEqual(DEFAULT_SHELL_PREFS);
    expect(DEFAULT_SHELL_PREFS).toEqual({ closeToTray: true, startMinimized: false, notify: true, hotkeyConnect: null });
  });

  it('keys_are_shared_with_the_shell_file', () => {
    for (const key of Object.values(SHELL_PREF_KEYS)) expect(UI_STATE_KEYS).toContain(key);
  });

  it('round_trips_flags_as_1_0', () => {
    expect(writeShellFlag('closeToTray', false)).toBe(true);
    expect(writeShellFlag('startMinimized', true)).toBe(true);
    expect(window.localStorage.getItem(SHELL_PREF_KEYS.closeToTray)).toBe('0');
    expect(window.localStorage.getItem(SHELL_PREF_KEYS.startMinimized)).toBe('1');
    expect(readShellPrefs()).toMatchObject({ closeToTray: false, startMinimized: true });
  });

  it('invalid_values_fall_back_to_defaults', () => {
    window.localStorage.setItem(SHELL_PREF_KEYS.closeToTray, 'yes');
    window.localStorage.setItem(SHELL_PREF_KEYS.notify, '');
    window.localStorage.setItem(SHELL_PREF_KEYS.hotkeyConnect, '   ');
    expect(readShellPrefs()).toEqual(DEFAULT_SHELL_PREFS);
  });

  it('accepts_legacy_true_false', () => {
    window.localStorage.setItem(SHELL_PREF_KEYS.notify, 'false');
    expect(readShellPrefs().notify).toBe(false);
  });

  it('hotkey_set_and_cleared', () => {
    expect(writeHotkeyConnect('Ctrl+Alt+K')).toBe(true);
    expect(readShellPrefs().hotkeyConnect).toBe('Ctrl+Alt+K');
    expect(writeHotkeyConnect(null)).toBe(true);
    expect(window.localStorage.getItem(SHELL_PREF_KEYS.hotkeyConnect)).toBeNull();
    expect(readShellPrefs().hotkeyConnect).toBeNull();
  });

  it('unavailable_storage_reads_defaults_and_reports_write_failure', () => {
    expect(readShellPrefs(broken)).toEqual(DEFAULT_SHELL_PREFS);
    expect(writeShellFlag('notify', false, broken)).toBe(false);
    expect(writeHotkeyConnect('Ctrl+K', broken)).toBe(false);
  });
});
