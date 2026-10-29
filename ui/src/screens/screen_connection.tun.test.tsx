// SPDX-License-Identifier: GPL-3.0-only

// screen_connection.tun.test.tsx — T-46, T-81: без прав администратора режим TUN
// не пытается подключаться, а предлагает перезапуск от администратора (службы
// нет, как в NekoBox). Ядро — мок fetch, оболочка — мок invoke.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CoreContext } from '../hooks/useCore';
import { createCoreClients, type CoreClients } from '../lib/core';
import { toggleConnection } from '../lib/connection';
import { setLanguage } from '../lib/i18n';
import { ConnectionScreen } from './screen_connection';

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }));

const requests: { path: string; body: unknown }[] = [];

function installCore(extra: Record<string, unknown> = {}): void {
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(href).pathname;
    const raw = init?.body;
    const text = typeof raw === 'string' ? raw : ArrayBuffer.isView(raw) ? new TextDecoder().decode(raw) : '';
    requests.push({ path, body: text === '' ? null : (JSON.parse(text) as unknown) });
    const rpc = path.split('/').slice(-2).join('/').replace(/^lavray\.v1\./, '');
    // activeProfileId задан явно: без него экран в IDLE не рисует кнопку (T-04).
    const body =
      extra[rpc] ??
      (path.endsWith('.CoreService/GetStatus')
        ? { state: 'CORE_STATE_IDLE', activeProfileId: '0', inbound: { port: 2080 } }
        : path.endsWith('.ProfileService/ListProfiles')
          ? { profiles: [{ id: '1', name: 'Frankfurt 01', address: 'example.org', port: 443 }] }
          : {});
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

const connectCalls = (): number =>
  requests.filter((r) => r.path.endsWith('.CoreService/Connect')).length;
const rememberedModes = (): unknown[] =>
  requests
    .filter((r) => r.path.endsWith('.SettingsService/SetSettings'))
    .map((r) => (r.body as { values?: Record<string, unknown> } | null)?.values?.['remember.modes']);
const button = (): HTMLButtonElement | null => document.querySelector('button.btn-lg');
const notice = (): Element | null => document.querySelector('.banner-warn');
const dialog = (): Element | null => document.querySelector('#tunDlgTitle');
const badge = (): Element | null => document.querySelector('.cx-mode-row .mode-admin');
const tunSwitch = (): HTMLButtonElement | null =>
  document.querySelectorAll<HTMLButtonElement>('.cx-mode-row .sw')[1] ?? null;
const stored = (): unknown => JSON.parse(window.localStorage.getItem('lavray.modes') ?? 'null');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const pause = (ms = 10): Promise<void> =>
  act(async () => {
    await sleep(ms);
  });

describe('TUN without administrator rights (T-46, T-81)', () => {
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    window.localStorage.clear();
    setLanguage('en');
    requests.length = 0;
    installCore();
    root = createRoot(document.body.appendChild(document.createElement('div')));
  });
  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.innerHTML = '';
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  /** Новый корень: предыдущий тест-шаг размонтирован. */
  function remount(): void {
    act(() => {
      root.unmount();
    });
    document.body.innerHTML = '';
    root = createRoot(document.body.appendChild(document.createElement('div')));
  }

  function render(): void {
    const clients = createCoreClients('http://127.0.0.1:1');
    act(() => {
      root.render(
        <CoreContext.Provider value={clients}>
          <ConnectionScreen />
        </CoreContext.Provider>,
      );
    });
  }

  async function open(
    tun: boolean,
    elevated: boolean | null,
    relaunch: 'started' | 'cancelled' | Error = 'started',
  ): Promise<void> {
    window.localStorage.setItem('lavray.modes', JSON.stringify({ sysProxy: false, tunMode: tun }));
    shell.invoke.mockReset().mockImplementation((cmd: string) => {
      if (cmd === 'is_elevated') return Promise.resolve(elevated);
      if (cmd === 'relaunch_elevated') {
        return relaunch instanceof Error ? Promise.reject(relaunch) : Promise.resolve(relaunch);
      }
      return Promise.resolve(null);
    });
    render();
    for (let i = 0; i < 40 && (button() === null || (elevated === false && badge() === null)); i += 1) {
      await pause();
    }
  }

  /** Включить TUN переключателем без прав: открывается диалог. */
  async function openDialogByToggle(): Promise<void> {
    await act(async () => {
      tunSwitch()?.click();
      await sleep(20);
    });
  }

  async function pressRelaunch(): Promise<void> {
    await act(async () => {
      document.querySelector<HTMLButtonElement>('#tunRelaunch')?.click();
      await sleep(30);
    });
  }

  it('explains what to do and offers the restart instead of connecting', async () => {
    await open(true, false);
    expect(notice()?.textContent).toContain('To use TUN, run LAVRay as administrator');
    expect(button()?.disabled).toBe(false);
    await act(async () => {
      button()?.click();
      await sleep(20);
    });
    expect(connectCalls()).toBe(0);
    expect(dialog()?.textContent).toBe('Turn on TUN mode');

    act(() => {
      setLanguage('ru');
    });
    await pause();
    expect(notice()?.textContent).toContain('Для TUN запустите LAVRay от имени администратора');
    expect(dialog()?.textContent).toBe('Включить режим TUN');
  });

  it('connects in TUN mode when the shell is elevated; no TUN — no warning', async () => {
    await open(true, true);
    expect(notice()).toBeNull();
    expect(badge()).toBeNull();
    await act(async () => {
      button()?.click();
      await sleep(20);
    });
    expect(connectCalls()).toBe(1);
    expect(dialog()).toBeNull();

    remount();
    await open(false, false);
    expect(notice()).toBeNull();
    expect(button()?.disabled).toBe(false);
  });

  it('Ctrl+D / menu path: toggleConnection does not connect and lets the screen explain', async () => {
    window.localStorage.setItem('lavray.modes', JSON.stringify({ sysProxy: false, tunMode: true }));
    shell.invoke.mockReset().mockResolvedValue(false);
    const connect = vi.fn();
    const core = { core: { connect }, profiles: { listProfiles: vi.fn() } } as unknown as CoreClients;

    expect(await toggleConnection({ core, connected: false, port: 2080 })).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });

  it('admin_badge_is_shown_without_rights_only', async () => {
    await open(false, false);
    expect(badge()?.textContent).toBe('admin');
    expect(badge()?.closest('.cx-mode-row')?.textContent).toContain('TUN');
    // бейдж — только на пункте TUN, не на системном прокси
    expect(document.querySelectorAll('.cx-mode-row .mode-admin')).toHaveLength(1);

    act(() => {
      setLanguage('ru');
    });
    await pause();
    expect(badge()?.textContent).toBe('админ');

    remount();
    await open(false, true);
    expect(badge()).toBeNull(); // права есть

    remount();
    await open(false, null);
    expect(badge()).toBeNull(); // оболочка не ответила (веб-режим) — бейджа нет
  });

  it('tun_toggle_without_rights_opens_the_restart_dialog', async () => {
    await open(false, false);
    await openDialogByToggle();
    expect(dialog()).not.toBeNull();
    expect(document.querySelector('.dlg-b')?.textContent).toContain('administrator');
    // пока не перезапустились, режим не меняется и ничего не уходит в ядро
    expect(tunSwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(stored()).toEqual({ sysProxy: false, tunMode: false });
    expect(rememberedModes()).toEqual([]);

    // «Отмена» закрывает диалог, ничего не запуская
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.dlg-f .btn-ghost')?.click();
      await sleep(10);
    });
    expect(dialog()).toBeNull();
    expect(shell.invoke.mock.calls.filter(([cmd]) => cmd === 'relaunch_elevated')).toEqual([]);
  });

  it('tun_dialog_button_calls_relaunch_elevated_and_keeps_tun_selected', async () => {
    await open(false, false);
    await openDialogByToggle();
    expect(document.querySelector('#tunRelaunch')?.textContent).toBe('Restart as administrator');

    await pressRelaunch();

    expect(shell.invoke).toHaveBeenCalledWith('relaunch_elevated');
    // выбор TUN записан заранее: и в окне, и в настройке ядра remember.modes
    expect(stored()).toEqual({ sysProxy: false, tunMode: true });
    expect(rememberedModes()).toEqual([{ stringListValue: { items: ['tun'] } }]);
    // приложение закрывается само: диалог остаётся занятым
    expect(document.querySelector<HTMLButtonElement>('#tunRelaunch')?.disabled).toBe(true);
    expect(connectCalls()).toBe(0);
  });

  it('UAC refusal keeps the app as it was: message, previous modes restored', async () => {
    await open(false, false, 'cancelled');
    await openDialogByToggle();
    await pressRelaunch();

    expect(document.querySelector('.dlg-b')?.textContent).toContain('System prompt declined');
    expect(document.querySelector<HTMLButtonElement>('#tunRelaunch')?.disabled).toBe(false);
    expect(stored()).toEqual({ sysProxy: false, tunMode: false });
    expect(rememberedModes().at(-1)).toEqual({ stringListValue: {} }); // пустой список protojson опускает
    expect(window.localStorage.getItem('lavray.tunRelaunch')).toBeNull();
  });

  it('relaunch failure is shown in the dialog; an unsupported OS gets its own text', async () => {
    await open(false, false, new Error('ShellExecuteEx: код ошибки Windows 5'));
    await openDialogByToggle();
    await pressRelaunch();
    expect(document.querySelector('.dlg-b .banner-err')?.textContent).toBe(
      'Could not restart as administrator: ShellExecuteEx: код ошибки Windows 5',
    );
    expect(stored()).toEqual({ sysProxy: false, tunMode: false });

    remount();
    await open(false, false, new Error('unsupported'));
    await openDialogByToggle();
    await pressRelaunch();
    expect(document.querySelector('.dlg-b .banner-err')?.textContent).toContain('Windows only');
  });

  it('the restart button of the warning opens the same dialog', async () => {
    await open(true, false);
    await act(async () => {
      document.querySelector<HTMLButtonElement>('#tunNoticeRestart')?.click();
      await sleep(20);
    });
    expect(dialog()).not.toBeNull();
  });

  it('after the elevated relaunch TUN is on and the screen says so once', async () => {
    window.localStorage.setItem('lavray.tunRelaunch', '1');
    await open(true, true);
    await pause(30);
    expect(document.querySelector('#stateCard > .hint')?.textContent).toBe(
      'TUN mode is on: LAVRay is running as administrator',
    );
    expect(tunSwitch()?.getAttribute('aria-checked')).toBe('true');
    expect(window.localStorage.getItem('lavray.tunRelaunch')).toBeNull();
  });

  it('modes lost with the window profile come back from the core setting', async () => {
    // localStorage пуст, ядро помнит режимы (запись перед перезапуском)
    installCore({
      'SettingsService/GetSettings': { values: { 'remember.modes': { stringListValue: { items: ['tun', 'system_proxy'] } } } },
    });
    shell.invoke.mockReset().mockResolvedValue(true);
    render();
    for (let i = 0; i < 40 && tunSwitch()?.getAttribute('aria-checked') !== 'true'; i += 1) {
      await pause();
    }
    expect(tunSwitch()?.getAttribute('aria-checked')).toBe('true');
    expect(stored()).toEqual({ sysProxy: true, tunMode: true });
  });
});
