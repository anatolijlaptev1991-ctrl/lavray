// SPDX-License-Identifier: GPL-3.0-only

// linuxCaps.test.tsx — возможности оболочки в интерфейсе: на Linux нет «Снять
// экран», нет установки и отката обновления (вместо них строка про пакет),
// глобальная клавиша отключена с причиной, у настроек трея есть пояснение,
// тексты без `.exe`, а автозапуск не предлагает «перезапуск от администратора».
// На Windows и в вебе ничего из этого не меняется. Оболочка — мок invoke.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import type { UpdateFlowApi } from '../hooks/useUpdateFlow';
import { setLanguage } from '../lib/i18n';
import { loadShellCaps, resetShellCaps } from '../lib/shellCaps';
import type { FlowState } from '../lib/updates/types';
import { mountBare, unmountAll } from '../test-utils/coreStub';
import { UpdateOfferCard } from '../screens/updates/UpdateOfferCard';
import { AutostartRow } from './AutostartRow';
import { GlobalHotkeyRow } from './settings/GlobalHotkeyRow';
import { ShellPrefRows } from './settings/ShellPrefRows';
import { QrTab } from './import/QrTab';
import { NekoBoxForm } from './nekobox/NekoBoxForm';

const invokeMock = vi.hoisted(() => vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const LINUX = {
  os: 'linux',
  sessionType: 'wayland',
  packaging: 'deb',
  tunAccess: 'grant',
  screenCapture: false,
  selfUpdate: false,
  globalHotkeys: false,
  trayAvailable: false,
};
const WINDOWS = {
  os: 'windows',
  sessionType: '',
  packaging: 'installed',
  tunAccess: 'admin',
  screenCapture: true,
  selfUpdate: true,
  globalHotkeys: true,
  trayAvailable: true,
};
const autostart = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  supported: true,
  enabled: false,
  method: null,
  elevated: false,
  installed: true,
  unknown: false,
  notice: null,
  ...over,
});

async function useShell(caps: Record<string, unknown> | null, extra: Record<string, unknown> = {}): Promise<void> {
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  invokeMock.mockReset().mockImplementation((cmd: string) => {
    if (cmd === 'shell_capabilities') {
      return caps === null ? Promise.reject(new Error('command not found')) : Promise.resolve(caps);
    }
    return cmd in extra ? Promise.resolve(extra[cmd]) : Promise.resolve(null);
  });
  await loadShellCaps();
}

beforeEach(() => {
  setLanguage('en');
  resetShellCaps();
  window.localStorage.clear();
});
afterEach(() => {
  unmountAll();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  resetShellCaps();
});

describe('снимок экрана для QR', () => {
  it('Linux: кнопки «Снять экран» нет, файл остаётся', async () => {
    await useShell(LINUX);
    const v = await mountBare(createElement(QrTab, { onDecoded: vi.fn() }));
    expect(v.container.querySelector('input[type="file"]')).not.toBeNull();
    expect(v.container.textContent).not.toContain('screen');
  });

  it('Windows: кнопка есть (и со старой оболочкой без команды тоже)', async () => {
    await useShell(WINDOWS);
    const withCaps = await mountBare(createElement(QrTab, { onDecoded: vi.fn() }));
    expect(withCaps.container.querySelectorAll('button.btn-sec')).toHaveLength(1);
    withCaps.unmount();
    resetShellCaps();
    await useShell(null);
    const old = await mountBare(createElement(QrTab, { onDecoded: vi.fn() }));
    expect(old.container.querySelectorAll('button.btn-sec')).toHaveLength(1);
  });
});

describe('глобальная клавиша', () => {
  it('Wayland: кнопка выключена, причина названа', async () => {
    await useShell(LINUX);
    const v = await mountBare(createElement(GlobalHotkeyRow));
    expect(v.container.querySelector<HTMLButtonElement>('#globalHotkeyRow button')?.disabled).toBe(true);
    expect(v.container.querySelector('#globalHotkeyRow [role="status"]')?.textContent).toBe(
      'Not available in a Wayland session',
    );
  });

  it('другая среда без клавиш: общее пояснение; Windows: кнопка работает, пояснения нет', async () => {
    await useShell({ ...LINUX, sessionType: 'x11' });
    const x11 = await mountBare(createElement(GlobalHotkeyRow));
    expect(x11.container.querySelector('#globalHotkeyRow [role="status"]')?.textContent).toBe(
      'Not available in this environment',
    );
    x11.unmount();
    resetShellCaps();
    await useShell(WINDOWS);
    const win = await mountBare(createElement(GlobalHotkeyRow));
    expect(win.container.querySelector<HTMLButtonElement>('#globalHotkeyRow button')?.disabled).toBe(false);
    expect(win.container.querySelector('#globalHotkeyRow [role="status"]')).toBeNull();
  });
});

describe('трей', () => {
  it('нет значка в трее: пояснение у «в трей» и «свёрнутым», у уведомлений его нет', async () => {
    await useShell(LINUX);
    const v = await mountBare(createElement(ShellPrefRows));
    const note = (id: string): string | null =>
      v.container.querySelector(`#${id} [role="note"]`)?.textContent ?? null;
    expect(note('closeToTrayRow')).toContain('no tray icon');
    expect(note('startMinimizedRow')).toContain('no tray icon');
    expect(note('notifyRow')).toBeNull();
  });

  it('Windows: пояснения нет', async () => {
    await useShell(WINDOWS);
    const v = await mountBare(createElement(ShellPrefRows));
    expect(v.container.querySelector('[role="note"]')).toBeNull();
  });
});

describe('обновления', () => {
  const update = { version: '1.2.0', currentVersion: '1.1.0', mandatory: false, channel: 'stable', notes: {} };
  const flow = { install: vi.fn(), download: vi.fn(), cancelDownload: vi.fn() } as unknown as UpdateFlowApi;
  const offer = (kind: 'available' | 'ready'): FlowState =>
    ({ kind, update, ...(kind === 'ready' ? { staged: {}, askSession: false, notice: null } : {}) }) as unknown as FlowState;
  const card = (kind: 'available' | 'ready'): ReturnType<typeof createElement> =>
    createElement(UpdateOfferCard, { state: offer(kind) as never, flow });

  it('Linux: вместо «Скачать»/«Установить» строка с командой пакета, без ссылок', async () => {
    await useShell(LINUX);
    for (const kind of ['available', 'ready'] as const) {
      const v = await mountBare(card(kind));
      expect(v.container.querySelector('button')).toBeNull();
      expect(v.container.querySelector('#updPackageNote')?.textContent).toContain(
        'sudo apt install ./lavray-1.2.0-linux-amd64.deb',
      );
      expect(v.container.querySelector('a')).toBeNull();
      expect(v.container.textContent).not.toMatch(/Windows|\.exe/);
      v.unmount();
    }
  });

  it('Windows и веб: кнопки прежние', async () => {
    await useShell(WINDOWS);
    const win = await mountBare(card('ready'));
    expect(win.container.querySelector('button.btn-pri')?.textContent).toBe('Install now');
    win.unmount();
    resetShellCaps();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const web = await mountBare(card('available'));
    expect(web.container.querySelector('button.btn-pri')?.textContent).toBe('Download update');
    expect(web.container.querySelector('#updPackageNote')).toBeNull();
  });
});

describe('автозапуск', () => {
  it('Linux: запись сеанса, кнопки «перезапустить от администратора» нет, слов про планировщик нет', async () => {
    await useShell(LINUX, { autostart_state: autostart({ method: 'desktop_entry' }) });
    const v = await mountBare(createElement(AutostartRow));
    expect(v.container.querySelector('#autostartRow')).not.toBeNull();
    expect(v.container.querySelector('#autostartRelaunch')).toBeNull();
    expect(v.container.textContent).not.toMatch(/administrator|scheduled task|registry|Windows/i);
  });

  it('Windows: обычный неповышенный автозапуск по-прежнему предлагает перезапуск', async () => {
    await useShell(WINDOWS, { autostart_state: autostart({ method: 'task' }) });
    const v = await mountBare(createElement(AutostartRow));
    expect(v.container.querySelector('#autostartRelaunch')).not.toBeNull();
  });
});

describe('тексты без .exe на Linux', () => {
  it('перенос из NekoBox: путь Linux и «автопоиска нет»', async () => {
    await useShell(LINUX);
    const props = {
      candidates: [],
      loading: false,
      path: '',
      pathRef: { current: null },
      busy: false,
      routes: true,
      settings: true,
      onPath: vi.fn(),
      onPick: vi.fn(),
      onRoutes: vi.fn(),
      onSettings: vi.fn(),
    };
    const v = await mountBare(createElement(NekoBoxForm, props as never));
    expect(v.container.textContent).toContain('~/.config/nekoray/config');
    expect(v.container.textContent).not.toMatch(/nekobox\.exe|\.exe/);
    expect(v.container.querySelector('#nbPathHint')?.textContent).not.toContain('portable');
  });

  it('на Windows прежний текст про nekobox.exe', async () => {
    await useShell(WINDOWS);
    const props = {
      candidates: [],
      loading: false,
      path: '',
      pathRef: { current: null },
      busy: false,
      routes: true,
      settings: true,
      onPath: vi.fn(),
      onPick: vi.fn(),
      onRoutes: vi.fn(),
      onSettings: vi.fn(),
    };
    const v = await mountBare(createElement(NekoBoxForm, props as never));
    expect(v.container.querySelector('#nbPathHint')?.textContent).toContain('nekobox.exe');
  });
});
