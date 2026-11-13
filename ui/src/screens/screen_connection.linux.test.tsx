// SPDX-License-Identifier: GPL-3.0-only

// screen_connection.linux.test.tsx — TUN на Linux: прав администратора нет, ядру
// выдаётся разрешение управлять сетью (`tun_access_state` / `tun_access_grant`),
// приложение не перезапускается. Ядро — мок fetch, оболочка — мок invoke.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CoreContext } from '../hooks/useCore';
import { createCoreClients } from '../lib/core';
import { setCoreEndpoint } from '../lib/coreEndpoint';
import { requestTunDialog } from '../lib/tunRequest';
import { setLanguage } from '../lib/i18n';
import { loadShellCaps, resetShellCaps } from '../lib/shellCaps';
import { ConnectionScreen } from './screen_connection';

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }));
// Таймаут ожидания перезапуска ядра сокращён: настоящий — 30 с.
vi.mock('../lib/coreRestart', async (original) => {
  const real = await original<{ restartCoreAndWait: (ms: number) => Promise<void> }>();
  return { ...real, restartCoreAndWait: (): Promise<void> => real.restartCoreAndWait(60) };
});

const requests: string[] = [];
const IDLE = { state: 'CORE_STATE_IDLE', activeProfileId: '0', inbound: { port: 2080 } };
let coreStatus: Record<string, unknown> = IDLE;

function installCore(): void {
  globalThis.fetch = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(href).pathname;
    requests.push(path);
    const body = path.endsWith('.CoreService/GetStatus')
      ? coreStatus
      : path.endsWith('.ProfileService/ListProfiles')
        ? { profiles: [{ id: '1', name: 'Frankfurt 01', address: 'example.org', port: 443 }] }
        : {};
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  });
}

const LINUX_CAPS = {
  os: 'linux',
  sessionType: 'x11',
  packaging: 'deb',
  tunAccess: 'grant',
  screenCapture: false,
  selfUpdate: false,
  globalHotkeys: true,
  trayAvailable: true,
};
interface Access {
  state: string;
  reason: string;
  command: string;
  needsCoreRestart: boolean;
}
const GRANTABLE: Access = { state: 'grantable', reason: '', command: '', needsCoreRestart: false };
const READY: Access = { state: 'ready', reason: '', command: '', needsCoreRestart: false };

const connectCalls = (): number => requests.filter((p) => p.endsWith('.CoreService/Connect')).length;
const button = (): HTMLButtonElement | null => document.querySelector('button.btn-lg');
const notice = (): Element | null => document.querySelector('.banner-warn');
const dialog = (): Element | null => document.querySelector('#tunDlgTitle');
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const pause = (ms = 10): Promise<void> =>
  act(async () => {
    await sleep(ms);
  });
const press = async (selector: string): Promise<void> => {
  await act(async () => {
    document.querySelector<HTMLButtonElement>(selector)?.click();
    await sleep(40);
  });
};
const invoked = (cmd: string): number => shell.invoke.mock.calls.filter(([c]) => c === cmd).length;

describe('TUN on Linux: permission instead of administrator', () => {
  let root: Root;
  let access: Access;
  let grant: () => Promise<unknown>;

  async function open(initial: Access, tun = true): Promise<void> {
    access = initial;
    grant = (): Promise<unknown> => {
      access = READY;
      return Promise.resolve(null);
    };
    window.localStorage.setItem('lavray.modes', JSON.stringify({ sysProxy: false, tunMode: tun }));
    shell.invoke.mockReset().mockImplementation((cmd: string) => {
      if (cmd === 'shell_capabilities') return Promise.resolve(LINUX_CAPS);
      if (cmd === 'tun_access_state') return Promise.resolve(access);
      if (cmd === 'tun_access_grant') return grant();
      if (cmd === 'restart_core') {
        setCoreEndpoint('tcp://127.0.0.1:9', 'new-token');
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });
    await loadShellCaps();
    const clients = createCoreClients('http://127.0.0.1:1');
    act(() => {
      root.render(
        <CoreContext.Provider value={clients}>
          <ConnectionScreen />
        </CoreContext.Provider>,
      );
    });
    for (let i = 0; i < 40 && button() === null; i += 1) await pause();
    await pause(20);
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    window.localStorage.clear();
    setLanguage('en');
    requests.length = 0;
    coreStatus = IDLE;
    installCore();
    root = createRoot(document.body.appendChild(document.createElement('div')));
  });
  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.innerHTML = '';
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    resetShellCaps();
    setCoreEndpoint('', '');
  });

  it('shows a permission notice without administrator words and never asks is_elevated', async () => {
    await open(GRANTABLE);
    expect(notice()?.textContent).toContain('needs permission to manage the network');
    expect(document.body.textContent).not.toMatch(/administrator|UAC|Windows/i);
    expect(document.querySelector('.mode-admin')?.textContent).toBe('access');
    expect(invoked('is_elevated')).toBe(0);
  });

  it('grantable: the dialog grants once, then the deferred connect goes through without a restart', async () => {
    await open(GRANTABLE);
    await press('button.btn-lg');
    expect(connectCalls()).toBe(0);
    expect(dialog()).not.toBeNull();
    expect(document.querySelector('.dlg')?.textContent).toContain('will ask for a password once');
    await press('#tunGrant');
    expect(invoked('tun_access_grant')).toBe(1);
    expect(invoked('restart_core')).toBe(0);
    expect(invoked('relaunch_elevated')).toBe(0);
    expect(connectCalls()).toBe(1);
    expect(dialog()).toBeNull();
  });

  it('after the grant the core restarts first when the shell says so, then connects', async () => {
    await open(GRANTABLE);
    await press('button.btn-lg');
    grant = (): Promise<unknown> => {
      access = { ...READY, needsCoreRestart: true };
      return Promise.resolve(null);
    };
    // После перезапуска оболочка уже не просит перезапуск.
    shell.invoke.mockImplementation((cmd: string) => {
      if (cmd === 'tun_access_state') return Promise.resolve(access);
      if (cmd === 'tun_access_grant') return grant();
      if (cmd === 'restart_core') {
        access = READY;
        setCoreEndpoint('tcp://127.0.0.1:9', 'new-token');
      }
      return Promise.resolve(null);
    });
    await press('#tunGrant');
    expect(invoked('restart_core')).toBe(1);
    expect(connectCalls()).toBe(1);
  });

  it('cancelling the password is a calm message, not an error', async () => {
    await open(GRANTABLE);
    await press('button.btn-lg');
    grant = (): Promise<unknown> => Promise.reject(new Error('cancelled'));
    await press('#tunGrant');
    expect(document.querySelector('.dlg')?.textContent).toContain('permission was not granted');
    expect(document.querySelector('.dlg .banner-err')).toBeNull();
    expect(connectCalls()).toBe(0);
  });

  it('a failed grant shows the shell text', async () => {
    await open(GRANTABLE);
    await press('button.btn-lg');
    grant = (): Promise<unknown> => Promise.reject(new Error('failed: pkexec missing'));
    await press('#tunGrant');
    expect(document.querySelector('.dlg .banner-err')?.textContent).toContain('pkexec missing');
  });

  it('manual: shows the ready command with a copy button', async () => {
    await open({ state: 'manual', reason: '', command: 'sudo setcap cap_net_admin+ep /usr/lib/lavray/lavray-core', needsCoreRestart: false });
    await press('button.btn-lg');
    expect(document.querySelector('#tunGrantCommand')?.textContent).toBe(
      'sudo setcap cap_net_admin+ep /usr/lib/lavray/lavray-core',
    );
    expect(document.querySelector('#tunGrantCopy')).not.toBeNull();
    expect(connectCalls()).toBe(0);
  });

  it('unavailable in an AppImage: says to install the deb package', async () => {
    await open({ state: 'unavailable', reason: 'appimage', command: '', needsCoreRestart: false });
    expect(notice()?.textContent).toBe('TUN mode is not available in the AppImage; install the deb package');
    expect(notice()?.querySelector('button')).toBeNull();
    await press('button.btn-lg');
    expect(connectCalls()).toBe(0);
    expect(document.querySelector('.dlg')?.textContent).toContain('install the deb package');
  });

  it('ready: connects at once, no dialogs and no notice', async () => {
    await open(READY);
    expect(notice()).toBeNull();
    await press('button.btn-lg');
    expect(connectCalls()).toBe(1);
    expect(dialog()).toBeNull();
    expect(invoked('restart_core')).toBe(0);
  });

  it('ready but the core must restart: restarts once, then connects', async () => {
    await open({ ...READY, needsCoreRestart: true });
    shell.invoke.mockImplementation((cmd: string) => {
      if (cmd === 'tun_access_state') return Promise.resolve(access);
      if (cmd === 'restart_core') {
        access = READY;
        setCoreEndpoint('tcp://127.0.0.1:9', 'new-token');
      }
      return Promise.resolve(null);
    });
    await press('button.btn-lg');
    expect(invoked('restart_core')).toBe(1);
    expect(connectCalls()).toBe(1);
  });

  it('without TUN nothing about permissions is asked or shown', async () => {
    await open(GRANTABLE, false);
    expect(notice()).toBeNull();
    await press('button.btn-lg');
    expect(connectCalls()).toBe(1);
  });

  it('an old shell without the commands: connecting is not blocked', async () => {
    await open(GRANTABLE);
    shell.invoke.mockImplementation((cmd: string) =>
      cmd === 'tun_access_state' ? Promise.reject(new Error('command not found')) : Promise.resolve(null),
    );
    await press('button.btn-lg');
    expect(connectCalls()).toBe(1);
  });

  it('просьба подключиться из трея / Ctrl+D: права есть — подключает; права выдаются — диалог', async () => {
    await open(READY);
    await act(async () => {
      requestTunDialog();
      await sleep(60);
    });
    expect(connectCalls()).toBe(1);
    expect(dialog()).toBeNull();
    requests.length = 0;
    access = GRANTABLE;
    await act(async () => {
      requestTunDialog();
      await sleep(60);
    });
    expect(connectCalls()).toBe(0);
    expect(dialog()).not.toBeNull();
  });

  it('просьба из трея, состояние доступа неизвестно (старая оболочка): подключает', async () => {
    await open(GRANTABLE);
    shell.invoke.mockImplementation((cmd: string) =>
      cmd === 'tun_access_state' ? Promise.reject(new Error('command not found')) : Promise.resolve(null),
    );
    await act(async () => {
      requestTunDialog();
      await sleep(60);
    });
    expect(connectCalls()).toBe(1);
  });

  it('закрыл диалог, пока шла выдача: VPN не подключается после отказа', async () => {
    await open(GRANTABLE);
    await press('button.btn-lg');
    let finish: () => void = () => undefined;
    grant = (): Promise<unknown> =>
      new Promise((resolve) => {
        finish = (): void => {
          access = READY;
          resolve(null);
        };
      });
    await press('#tunGrant');
    await press('.dlg .btn-ghost'); // «Отмена» во время выдачи
    expect(dialog()).toBeNull();
    await act(async () => {
      finish();
      await sleep(60);
    });
    expect(connectCalls()).toBe(0);
  });

  it('закрыл диалог во время перезапуска ядра после выдачи: подключения нет', async () => {
    await open(GRANTABLE);
    await press('button.btn-lg');
    grant = (): Promise<unknown> => {
      access = { ...READY, needsCoreRestart: true };
      return Promise.resolve(null);
    };
    let restartDone: () => void = () => undefined;
    shell.invoke.mockImplementation((cmd: string) => {
      if (cmd === 'tun_access_state') return Promise.resolve(access);
      if (cmd === 'tun_access_grant') return grant();
      if (cmd === 'restart_core') {
        restartDone = (): void => {
          access = READY;
          setCoreEndpoint('tcp://127.0.0.1:9', 'later');
        };
      }
      return Promise.resolve(null);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('#tunGrant')?.click();
      await sleep(20);
    });
    await press('.dlg .btn-ghost');
    await act(async () => {
      restartDone();
      await sleep(60);
    });
    expect(connectCalls()).toBe(0);
  });

  it('перезапуск ядра не дождался адреса: понятная ошибка, намерение сброшено, «ядро недоступно» не показано', async () => {
    await open({ ...READY, needsCoreRestart: true });
    shell.invoke.mockImplementation((cmd: string) =>
      cmd === 'tun_access_state' ? Promise.resolve(access) : Promise.resolve(null),
    );
    await press('button.btn-lg');
    await act(async () => {
      await sleep(120);
    });
    expect(document.querySelector('.dlg')?.textContent).toContain('did not restart in time');
    expect(connectCalls()).toBe(0);
    // поздний адрес намерение не оживляет
    await act(async () => {
      setCoreEndpoint('tcp://127.0.0.1:9', 'late');
      await sleep(60);
    });
    expect(connectCalls()).toBe(0);
  });

  it('ядро было подключено, TUN включают с перезапуском: соединение восстанавливается в режиме TUN', async () => {
    coreStatus = {
      state: 'CORE_STATE_CONNECTED',
      activeProfileId: '1',
      mode: 'CONNECT_MODE_SYSTEM_PROXY',
      coreVersion: '1',
      inbound: { port: 2080 },
    };
    await open({ ...READY, needsCoreRestart: true }, false);
    shell.invoke.mockImplementation((cmd: string) => {
      if (cmd === 'tun_access_state') return Promise.resolve(access);
      if (cmd === 'restart_core') {
        access = READY;
        coreStatus = IDLE;
        setCoreEndpoint('tcp://127.0.0.1:9', 'new-token');
      }
      return Promise.resolve(null);
    });
    await act(async () => {
      document.querySelectorAll<HTMLButtonElement>('.cx-mode-row .sw')[1]?.click();
      await sleep(150);
    });
    expect(invoked('restart_core')).toBe(1);
    expect(connectCalls()).toBe(1);
    expect(JSON.parse(window.localStorage.getItem('lavray.modes') ?? '{}')).toMatchObject({ tunMode: true });
  });

  it('busy от оболочки — спокойный текст; read_only не поминает AppImage', async () => {
    await open(GRANTABLE);
    await press('button.btn-lg');
    grant = (): Promise<unknown> => Promise.reject(new Error('busy'));
    await press('#tunGrant');
    expect(document.querySelector('.dlg')?.textContent).toContain('already in progress');
    expect(document.querySelector('.dlg .banner-err')).toBeNull();
  });

  it('unavailable read_only / nosuid: текст про раздел, без слова AppImage', async () => {
    await open({ state: 'unavailable', reason: 'read_only', command: '', needsCoreRestart: false });
    expect(notice()?.textContent).toContain('read-only');
    expect(notice()?.textContent).not.toMatch(/AppImage/);
  });
});
