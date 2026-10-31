// SPDX-License-Identifier: GPL-3.0-only

// GlobalHotkeyRow.test.tsx — T-82: строка глобального сочетания и диалог
// захвата. Сочетание проверяет и регистрирует оболочка; сохранённое пишется в
// ui-state только после её согласия; ошибки показываются текстом.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { setLanguage } from '../../lib/i18n';
import { SHELL_PREF_KEYS } from '../../lib/shellPrefs';
import { click, flush, mountBare, unmountAll } from '../../test-utils/coreStub';
import { GlobalHotkeyRow } from './GlobalHotkeyRow';

vi.mock('@tauri-apps/api/core', async () => (await import('../../test-utils/tauriStub')).tauriCoreModule);
vi.mock('@tauri-apps/api/event', async () => (await import('../../test-utils/tauriStub')).tauriEventModule);
const { tauri, enableTauri, disableTauri } = await import('../../test-utils/tauriStub');

const q = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const buttonByText = (text: string): HTMLButtonElement | null =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === text) ?? null;

async function press(code: string, mods: Partial<KeyboardEventInit> = {}): Promise<void> {
  const area = q('[role="dialog"] [role="textbox"]');
  await act(async () => {
    area?.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true, ...mods }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  setLanguage('en');
  tauri.reset();
  enableTauri();
});

afterEach(() => {
  unmountAll();
  window.localStorage.clear();
  disableTauri();
});

describe('глобальное сочетание (T-82)', () => {
  it('off_by_default_and_hidden_in_web', async () => {
    await mountBare(createElement(GlobalHotkeyRow));
    expect(q('#globalHotkeyRow kbd')?.textContent).toBe('Off');
    expect(buttonByText('Turn off')).toBeNull();
    unmountAll();
    disableTauri();
    await mountBare(createElement(GlobalHotkeyRow));
    expect(q('#globalHotkeyRow')).toBeNull();
  });

  it('hotkey_dialog_captures_combo_and_saves', async () => {
    tauri.onCall('hotkey_set', (args) => ((args as { accel: string }).accel === 'Ctrl+Alt+K' ? 'Ctrl+Alt+K' : null));
    await mountBare(createElement(GlobalHotkeyRow));
    await click(buttonByText('Set…'));
    expect(buttonByText('Save')?.disabled).toBe(true);
    await press('ControlLeft', { ctrlKey: true });
    expect(buttonByText('Save')?.disabled).toBe(true);
    await press('KeyK', { ctrlKey: true, altKey: true });
    expect(q('[role="dialog"] kbd')?.textContent).toBe('Ctrl+Alt+K');
    await click(buttonByText('Save'));
    await flush();
    expect(tauri.argsOf('hotkey_set')).toEqual([{ accel: 'Ctrl+Alt+K' }]);
    expect(window.localStorage.getItem(SHELL_PREF_KEYS.hotkeyConnect)).toBe('Ctrl+Alt+K');
    expect(q('[role="dialog"]')).toBeNull();
    expect(q('#globalHotkeyRow kbd')?.textContent).toBe('Ctrl+Alt+K');
  });

  it('rejects_without_modifier', async () => {
    tauri.onError('hotkey_set', 'no_modifier');
    await mountBare(createElement(GlobalHotkeyRow));
    await click(buttonByText('Set…'));
    await press('KeyK', { ctrlKey: true });
    await click(buttonByText('Save'));
    await flush();
    expect(q('[role="dialog"] [role="alert"]')?.textContent).toContain('Not enough modifiers');
    expect(window.localStorage.getItem(SHELL_PREF_KEYS.hotkeyConnect)).toBeNull();
  });

  it('shows_conflict', async () => {
    tauri.onError('hotkey_set', 'conflict');
    await mountBare(createElement(GlobalHotkeyRow));
    await click(buttonByText('Set…'));
    await press('KeyL', { ctrlKey: true, altKey: true });
    await click(buttonByText('Save'));
    await flush();
    expect(q('[role="dialog"] [role="alert"]')?.textContent).toContain('Another program');
    expect(q('[role="dialog"] [role="textbox"]')?.getAttribute('aria-describedby')).toBe('hkCaptureErr');
  });

  it('focus_and_labels', async () => {
    await mountBare(createElement(GlobalHotkeyRow));
    await click(buttonByText('Set…'));
    await flush();
    const area = q('[role="dialog"] [role="textbox"]');
    expect(area?.getAttribute('aria-label')).toBe('Shortcut capture field');
    expect(document.activeElement).toBe(area);
    expect(q('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe('hkCaptureTitle');
  });

  it('escape_is_not_captured', async () => {
    await mountBare(createElement(GlobalHotkeyRow));
    await click(buttonByText('Set…'));
    await press('Escape');
    expect(q('[role="dialog"] kbd')?.textContent ?? '…').toBe('…');
  });

  it('clear_unregisters_and_forgets', async () => {
    window.localStorage.setItem(SHELL_PREF_KEYS.hotkeyConnect, 'Ctrl+Alt+K');
    tauri.onValue('hotkey_set', null);
    await mountBare(createElement(GlobalHotkeyRow));
    expect(q('#globalHotkeyRow kbd')?.textContent).toBe('Ctrl+Alt+K');
    await click(buttonByText('Turn off'));
    await flush();
    expect(tauri.argsOf('hotkey_set')).toEqual([{ accel: null }]);
    expect(window.localStorage.getItem(SHELL_PREF_KEYS.hotkeyConnect)).toBeNull();
    expect(q('#globalHotkeyRow kbd')?.textContent).toBe('Off');
  });
});
