// SPDX-License-Identifier: GPL-3.0-only

// WindowBehaviorRows.test.tsx — T-82: «Закрывать в трей» и «Запускать
// свёрнутым» пишут общие ключи ui-state (их читает оболочка до создания окна),
// показывают сохранённое значение и не видны в веб-панели.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { setLanguage } from '../../lib/i18n';
import { SHELL_PREF_KEYS } from '../../lib/shellPrefs';
import { click, mountBare, unmountAll } from '../../test-utils/coreStub';
import { WindowBehaviorRows } from './WindowBehaviorRows';

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
}

const sw = (v: { container: HTMLElement }, id: string): HTMLElement | null =>
  v.container.querySelector(`#${id} .sw`);

beforeEach(() => {
  setLanguage('en');
  (window as TauriWindow).__TAURI_INTERNALS__ = {};
});

afterEach(() => {
  unmountAll();
  window.localStorage.clear();
  delete (window as TauriWindow).__TAURI_INTERNALS__;
});

describe('строки поведения окна (T-82)', () => {
  it('defaults_close_to_tray_on_start_minimized_off', async () => {
    const v = await mountBare(createElement(WindowBehaviorRows));
    expect(sw(v, 'closeToTrayRow')?.getAttribute('aria-checked')).toBe('true');
    expect(sw(v, 'startMinimizedRow')?.getAttribute('aria-checked')).toBe('false');
  });

  it('close_to_tray_toggle_writes_ui_state', async () => {
    const v = await mountBare(createElement(WindowBehaviorRows));
    await click(sw(v, 'closeToTrayRow'));
    expect(window.localStorage.getItem(SHELL_PREF_KEYS.closeToTray)).toBe('0');
    expect(sw(v, 'closeToTrayRow')?.getAttribute('aria-checked')).toBe('false');
    await click(sw(v, 'closeToTrayRow'));
    expect(window.localStorage.getItem(SHELL_PREF_KEYS.closeToTray)).toBe('1');
  });

  it('start_minimized_toggle_writes_ui_state', async () => {
    const v = await mountBare(createElement(WindowBehaviorRows));
    await click(sw(v, 'startMinimizedRow'));
    expect(window.localStorage.getItem(SHELL_PREF_KEYS.startMinimized)).toBe('1');
  });

  it('shows_saved_values', async () => {
    window.localStorage.setItem(SHELL_PREF_KEYS.closeToTray, '0');
    window.localStorage.setItem(SHELL_PREF_KEYS.startMinimized, '1');
    const v = await mountBare(createElement(WindowBehaviorRows));
    expect(sw(v, 'closeToTrayRow')?.getAttribute('aria-checked')).toBe('false');
    expect(sw(v, 'startMinimizedRow')?.getAttribute('aria-checked')).toBe('true');
  });

  it('switches_are_labelled', async () => {
    const v = await mountBare(createElement(WindowBehaviorRows));
    expect(sw(v, 'closeToTrayRow')?.getAttribute('role')).toBe('switch');
    expect(sw(v, 'closeToTrayRow')?.getAttribute('aria-label')).toBe('Minimize to tray on close');
    expect(sw(v, 'startMinimizedRow')?.getAttribute('aria-label')).toBe('Start minimized to tray');
  });

  it('hidden_in_web_panel', async () => {
    delete (window as TauriWindow).__TAURI_INTERNALS__;
    const v = await mountBare(createElement(WindowBehaviorRows));
    expect(v.container.querySelector('.set-row')).toBeNull();
  });
});
