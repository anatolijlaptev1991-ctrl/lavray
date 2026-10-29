// SPDX-License-Identifier: GPL-3.0-only

// T-81 (ревью): настоящий main.tsx в новом (пустом) профиле WebView повышенного
// экземпляра. Общие настройки приходят из файла оболочки ДО первого рендера:
// язык и признак онбординга уже верные, а последующие изменения уходят в файл.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DICTIONARIES } from './lib/i18n';

const shell = vi.hoisted(() => ({
  releaseLoad: undefined as undefined | (() => void),
  calls: [] as { cmd: string; args: unknown }[],
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: unknown): Promise<unknown> => {
    shell.calls.push({ cmd, args });
    if (cmd === 'ui_state_load') {
      // ответ оболочки приходит не сразу: рендер не должен его опережать
      await new Promise<void>((resolve) => {
        shell.releaseLoad = resolve;
      });
      return { exists: true, entries: { 'lavray.lang': 'de', 'lavray.onboarded': '1' } };
    }
    if (cmd === 'launch_info') return { elevated_relaunch: true };
    if (cmd === 'core_endpoint') return ['127.0.0.1:50001', 'tokenA'];
    if (cmd === 'window_is_maximized') return false;
    return null;
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

const intervals: ReturnType<typeof setInterval>[] = [];
const realSetInterval = globalThis.setInterval;

describe('первый запуск повышенного экземпляра с пустым профилем WebView', () => {
  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList,
    );
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    window.localStorage.clear(); // профиль пуст: ни языка, ни флага онбординга
    document.body.innerHTML = '<div id="root"></div>';
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((...args: Parameters<typeof setInterval>) => {
      const id = realSetInterval(...args);
      intervals.push(id);
      return id;
    }) as typeof setInterval);
    globalThis.fetch = (): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify({ state: 'CORE_STATE_IDLE', coreVersion: '1.14.1-lav.1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
  });
  afterEach(() => {
    intervals.splice(0).forEach((id) => {
      clearInterval(id);
    });
    vi.restoreAllMocks();
  });

  it('hydration_runs_before_the_first_render_and_changes_are_written_back', async () => {
    await import('./main');
    await vi.waitFor(() => {
      expect(shell.releaseLoad).toBeDefined();
    });
    // пока файл не прочитан, окно пустое: не мелькает английский и мастер первого запуска
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(document.getElementById('root')?.childElementCount).toBe(0);
    expect(window.localStorage.getItem('lavray.lang')).toBeNull();

    shell.releaseLoad?.();
    await vi.waitFor(() => {
      expect(document.querySelector('#connState')).not.toBeNull();
    });

    // язык и онбординг — из файла, а не умолчания пустого профиля
    expect(window.localStorage.getItem('lavray.lang')).toBe('de');
    expect(document.querySelector('#connState')?.textContent).toBe(DICTIONARIES.de['conn.state.off']);
    expect(document.querySelector('#onbTitle')).toBeNull();
    // порядок обращений к оболочке: файл настроек — раньше адреса ядра
    const order = shell.calls.map((c) => c.cmd);
    expect(order.indexOf('ui_state_load')).toBeLessThan(order.indexOf('core_endpoint'));
    // применение файла не считается изменением и обратно в файл не пишется
    expect(shell.calls.filter((c) => c.cmd === 'ui_state_set')).toEqual([]);

    // последующее изменение отслеживаемого ключа уходит в файл сразу
    window.localStorage.setItem('lavray.theme', 'dark');
    await vi.waitFor(() => {
      expect(shell.calls.filter((c) => c.cmd === 'ui_state_set').map((c) => c.args)).toContainEqual({
        key: 'lavray.theme',
        value: 'dark',
      });
    });
  }, 20000);
});
