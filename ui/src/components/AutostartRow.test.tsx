// SPDX-License-Identifier: GPL-3.0-only

// AutostartRow.test.tsx — T-82/Э-2: строка «Автозапуск» показывает состояние ОС
// (ответ оболочки), а не сохранённую настройку; включение и выключение идут
// командой оболочки; вне Windows и в веб-панели строки нет. Оболочка — мок invoke.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { setLanguage } from '../lib/i18n';
import { click, flush, mountBare, unmountAll } from '../test-utils/coreStub';
import { AutostartRow } from './AutostartRow';

const invokeMock = vi.hoisted(() => vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
}

/** Ответ оболочки `autostart_state` / `set_autostart`. */
const os = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  supported: true,
  enabled: false,
  method: null,
  elevated: false,
  notice: null,
  ...over,
});

const row = (v: { container: HTMLElement }): HTMLElement | null =>
  v.container.querySelector('#autostartRow');
const sw = (v: { container: HTMLElement }): HTMLElement | null =>
  v.container.querySelector('#autostartRow .sw');
const detail = (v: { container: HTMLElement }): string =>
  v.container.querySelector('#autostartRow [role="status"]')?.textContent ?? '';

beforeEach(() => {
  setLanguage('en');
  (window as TauriWindow).__TAURI_INTERNALS__ = {};
  invokeMock.mockReset();
});

afterEach(() => {
  unmountAll();
  delete (window as TauriWindow).__TAURI_INTERNALS__;
});

describe('строка «Автозапуск» (T-82)', () => {
  it('settings_autostart_row_reflects_os_state: выключено / задача / реестр', async () => {
    invokeMock.mockResolvedValue(os());
    const off = await mountBare(createElement(AutostartRow));
    expect(sw(off)?.getAttribute('aria-checked')).toBe('false');
    expect(invokeMock).toHaveBeenCalledWith('autostart_state');
    off.unmount();

    invokeMock.mockResolvedValue(os({ enabled: true, method: 'task', elevated: true }));
    const task = await mountBare(createElement(AutostartRow));
    expect(sw(task)?.getAttribute('aria-checked')).toBe('true');
    expect(detail(task)).toContain('administrator rights (scheduled task)');
    task.unmount();

    invokeMock.mockResolvedValue(os({ enabled: true, method: 'registry' }));
    const reg = await mountBare(createElement(AutostartRow));
    expect(sw(reg)?.getAttribute('aria-checked')).toBe('true');
    expect(detail(reg)).toContain('without administrator rights');
  });

  it('состояние читается из ОС при каждом показе, а не запоминается', async () => {
    invokeMock.mockResolvedValue(os());
    const first = await mountBare(createElement(AutostartRow));
    expect(sw(first)?.getAttribute('aria-checked')).toBe('false');
    first.unmount();

    // пока строки не было на экране, автозапуск включили средствами ОС
    invokeMock.mockResolvedValue(os({ enabled: true, method: 'registry' }));
    const second = await mountBare(createElement(AutostartRow));
    expect(sw(second)?.getAttribute('aria-checked')).toBe('true');
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'autostart_state')).toHaveLength(2);

    // и при возврате фокуса окну
    invokeMock.mockResolvedValue(os());
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    await flush();
    expect(sw(second)?.getAttribute('aria-checked')).toBe('false');
  });

  it('подсказка о способе зависит от прав: с правами — задача, без прав — обычный', async () => {
    invokeMock.mockResolvedValue(os({ elevated: true }));
    const admin = await mountBare(createElement(AutostartRow));
    expect(detail(admin)).toContain('scheduled task with administrator rights');
    admin.unmount();

    invokeMock.mockResolvedValue(os({ elevated: false }));
    const plain = await mountBare(createElement(AutostartRow));
    expect(detail(plain)).toContain('Without administrator rights autostart is the regular kind');
  });

  it('включение зовёт set_autostart и показывает ответ ОС', async () => {
    invokeMock.mockImplementation((cmd: string) =>
      Promise.resolve(
        cmd === 'set_autostart' ? os({ enabled: true, method: 'task', elevated: true }) : os({ elevated: true }),
      ),
    );
    const view = await mountBare(createElement(AutostartRow));

    await click(sw(view));

    expect(invokeMock).toHaveBeenCalledWith('set_autostart', { enabled: true });
    expect(sw(view)?.getAttribute('aria-checked')).toBe('true');
    expect(detail(view)).toContain('scheduled task');
  });

  it('выключение зовёт set_autostart с enabled=false', async () => {
    invokeMock.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'set_autostart' ? os() : os({ enabled: true, method: 'registry' })),
    );
    const view = await mountBare(createElement(AutostartRow));

    await click(sw(view));

    expect(invokeMock).toHaveBeenCalledWith('set_autostart', { enabled: false });
    expect(sw(view)?.getAttribute('aria-checked')).toBe('false');
  });

  it('задачу без прав не удалить: переключатель остаётся включённым и объясняет, что делать', async () => {
    invokeMock.mockImplementation((cmd: string) =>
      Promise.resolve(
        cmd === 'set_autostart'
          ? os({ enabled: true, method: 'task', notice: 'task_needs_admin' })
          : os({ enabled: true, method: 'task' }),
      ),
    );
    const view = await mountBare(createElement(AutostartRow));

    await click(sw(view));

    expect(sw(view)?.getAttribute('aria-checked')).toBe('true');
    const warn = view.container.querySelector('.banner-warn')?.textContent ?? '';
    expect(warn).toContain('Start LAVRay as administrator and try again');

    act(() => {
      setLanguage('ru');
    });
    await flush();
    expect(view.container.querySelector('.banner-warn')?.textContent ?? '').toContain(
      'Запустите LAVRay от имени администратора и повторите',
    );
  });

  it('ошибка команды показана текстом, состояние перечитано из ОС', async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'set_autostart' ? Promise.reject(new Error('reg add: Access is denied.')) : Promise.resolve(os()),
    );
    const view = await mountBare(createElement(AutostartRow));

    await click(sw(view));

    expect(view.container.querySelector('.banner-warn')?.textContent).toBe(
      'Could not change autostart: reg add: Access is denied.',
    );
    expect(sw(view)?.getAttribute('aria-checked')).toBe('false');
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'autostart_state')).toHaveLength(2);
  });

  it('вне Windows (supported=false), без оболочки и при сбое чтения строки нет', async () => {
    invokeMock.mockResolvedValue(os({ supported: false }));
    const unsupported = await mountBare(createElement(AutostartRow));
    expect(row(unsupported)).toBeNull();
    unsupported.unmount();

    invokeMock.mockRejectedValue(new Error('boom'));
    const broken = await mountBare(createElement(AutostartRow));
    expect(row(broken)).toBeNull();
    broken.unmount();

    delete (window as TauriWindow).__TAURI_INTERNALS__;
    invokeMock.mockReset();
    const web = await mountBare(createElement(AutostartRow));
    expect(row(web)).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
