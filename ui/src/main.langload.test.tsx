// SPDX-License-Identifier: GPL-3.0-only

// D-3: настоящий main.tsx грузит словарь стартового языка ДО первого рендера.
// В тестах все словари зарегистрированы заранее (test-setup.ts), поэтому здесь
// словарь немецкого языка «выгружается», и интерфейс обязан дождаться загрузки.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DICTIONARIES, registerDictionary } from './lib/i18n';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string): Promise<unknown> => {
    if (cmd === 'ui_state_load') {
      return Promise.resolve({ exists: true, entries: { 'lavray.lang': 'de', 'lavray.onboarded': '1' } });
    }
    if (cmd === 'launch_info') return Promise.resolve({ elevated_relaunch: false });
    if (cmd === 'core_endpoint') return Promise.resolve(['127.0.0.1:50001', 'tokenA']);
    if (cmd === 'window_is_maximized') return Promise.resolve(false);
    return Promise.resolve(null);
  },
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (): Promise<() => void> => Promise.resolve((): void => undefined),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: (): { onResized: () => Promise<() => void> } => ({
    onResized: (): Promise<() => void> => Promise.resolve((): void => undefined),
  }),
}));

const deDict = DICTIONARIES.de;

describe('main.tsx: словарь стартового языка', () => {
  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList,
    );
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    window.localStorage.clear();
    document.body.innerHTML = '<div id="root"></div>';
    registerDictionary('de', {});
    globalThis.fetch = (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'));
  });
  afterEach(() => {
    registerDictionary('de', deDict);
    vi.restoreAllMocks();
  });

  it('первый рендер уже на немецком, а не с ключами словаря', async () => {
    await import('./main');
    await vi.waitFor(() => {
      expect(document.querySelector('#connState')).not.toBeNull();
    });
    expect(document.querySelector('#connState')?.textContent).toBe(deDict['conn.state.off']);
    expect(document.querySelector('.sb-item')?.textContent).toBe(deDict['nav.connection']);
    expect(document.documentElement.lang).toBe('de');
  }, 20000);
});
