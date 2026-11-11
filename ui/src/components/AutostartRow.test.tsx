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
  installed: true,
  unknown: false,
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

  it('подсказка о способе зависит от прав и места установки', async () => {
    invokeMock.mockResolvedValue(os({ elevated: true }));
    const admin = await mountBare(createElement(AutostartRow));
    expect(detail(admin)).toContain('scheduled task with administrator rights');
    admin.unmount();

    // с правами, но не из Program Files (portable, Загрузки): задача не создастся
    invokeMock.mockResolvedValue(os({ elevated: true, installed: false }));
    const portable = await mountBare(createElement(AutostartRow));
    expect(detail(portable)).toContain('only for the installed version');
    expect(detail(portable)).not.toContain('scheduled task with administrator rights');
    portable.unmount();

    invokeMock.mockResolvedValue(os({ elevated: false }));
    const plain = await mountBare(createElement(AutostartRow));
    expect(detail(plain)).toContain('Without administrator rights autostart is the regular kind');
  });

  it('планировщик не прочитан: «неизвестно», а не «выключено»', async () => {
    invokeMock.mockResolvedValue(os({ unknown: true }));
    const view = await mountBare(createElement(AutostartRow));
    expect(detail(view)).toContain('Could not tell whether autostart through the scheduler is on');
    expect(detail(view)).not.toContain('Without administrator rights');
    expect(sw(view)?.getAttribute('aria-checked')).toBe('false');
    act(() => {
      setLanguage('ru');
    });
    await flush();
    expect(detail(view)).toContain('Не удалось определить, включён ли автозапуск');

    // значение Run при этом есть: автозапуск включён, о задаче по-прежнему ничего не известно
    invokeMock.mockResolvedValue(os({ unknown: true, enabled: true, method: 'registry' }));
    const withRun = await mountBare(createElement(AutostartRow));
    expect(sw(withRun)?.getAttribute('aria-checked')).toBe('true');
  });

  it('не установленная копия с правами: включился обычный автозапуск, причина названа', async () => {
    invokeMock.mockImplementation((cmd: string) =>
      Promise.resolve(
        cmd === 'set_autostart'
          ? os({ enabled: true, method: 'registry', elevated: true, installed: false, notice: 'task_installed_only' })
          : os({ elevated: true, installed: false }),
      ),
    );
    const view = await mountBare(createElement(AutostartRow));

    await click(sw(view));

    expect(sw(view)?.getAttribute('aria-checked')).toBe('true');
    expect(view.container.querySelector('.banner-warn')?.textContent).toContain(
      'only for the installed version',
    );
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

  it('повторное чтение, не удавшееся при возврате фокуса, не стирает показанную строку', async () => {
    invokeMock.mockResolvedValue(os({ enabled: true, method: 'registry' }));
    const view = await mountBare(createElement(AutostartRow));
    expect(sw(view)?.getAttribute('aria-checked')).toBe('true');

    invokeMock.mockRejectedValue(new Error('schtasks.exe: не запустился'));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    await flush();

    expect(row(view)).not.toBeNull();
    expect(sw(view)?.getAttribute('aria-checked')).toBe('true');
  });

  it('ошибка изменения видна, даже если состояние потом прочитать не удалось', async () => {
    let writes = 0;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'set_autostart') {
        writes += 1;
        return Promise.reject(new Error('reg add: Access is denied.'));
      }
      // первое чтение удалось, перечитывание после сбоя — нет
      return writes === 0 ? Promise.resolve(os()) : Promise.reject(new Error('нет ответа'));
    });
    const view = await mountBare(createElement(AutostartRow));

    await click(sw(view));

    expect(view.container.querySelector('.banner-warn')?.textContent).toBe(
      'Could not change autostart: reg add: Access is denied.',
    );
    expect(row(view)).not.toBeNull(); // переключатель остался рядом с сообщением
  });

  describe('кнопка «Перезапустить от администратора»', () => {
    const relaunchButton = (): HTMLButtonElement | null =>
      document.querySelector<HTMLButtonElement>('#autostartRelaunch');
    const dialogText = (): string => document.querySelector('.dlg')?.textContent ?? '';

    it('показана, когда выключить задачу или перейти на неё можно только с правами', async () => {
      // задача создана с правами, процесс обычный: отключить её без прав нельзя
      invokeMock.mockResolvedValue(os({ enabled: true, method: 'task' }));
      const viaTask = await mountBare(createElement(AutostartRow));
      expect(relaunchButton()?.textContent).toBe('Restart as administrator');
      viaTask.unmount();

      // автозапуск выключен, копия установлена: с правами включится задача
      invokeMock.mockResolvedValue(os());
      const off = await mountBare(createElement(AutostartRow));
      expect(relaunchButton()).not.toBeNull();
      off.unmount();

      // выключить не вышло — нужны права
      invokeMock.mockImplementation((cmd: string) =>
        Promise.resolve(
          cmd === 'set_autostart'
            ? os({ enabled: true, method: 'registry', notice: 'task_needs_admin' })
            : os({ enabled: true, method: 'registry' }),
        ),
      );
      const failed = await mountBare(createElement(AutostartRow));
      expect(relaunchButton()).toBeNull(); // обычный автозапуск менять можно и так
      await click(sw(failed));
      expect(relaunchButton()).not.toBeNull();
    });

    it('скрыта, когда права уже есть или повышение ничего не даст', async () => {
      invokeMock.mockResolvedValue(os({ enabled: true, method: 'task', elevated: true }));
      const admin = await mountBare(createElement(AutostartRow));
      expect(relaunchButton()).toBeNull();
      admin.unmount();

      // не установленная копия: задача невозможна и с правами
      invokeMock.mockResolvedValue(os({ installed: false }));
      const portable = await mountBare(createElement(AutostartRow));
      expect(relaunchButton()).toBeNull();
      portable.unmount();

      // обычный автозапуск включён: менять нечего
      invokeMock.mockResolvedValue(os({ enabled: true, method: 'registry' }));
      const plain = await mountBare(createElement(AutostartRow));
      expect(relaunchButton()).toBeNull();
      plain.unmount();
    });

    it('открывает диалог с текстами автозапуска; «Перезапустить» вызывает relaunch_elevated', async () => {
      invokeMock.mockImplementation((cmd: string) =>
        Promise.resolve(cmd === 'relaunch_elevated' ? 'started' : os({ enabled: true, method: 'task' })),
      );
      const view = await mountBare(createElement(AutostartRow));

      await click(relaunchButton());
      expect(dialogText()).toContain('Autostart with administrator rights can be turned on or off only');
      expect(dialogText()).not.toContain('TUN');

      await click(document.querySelector('#tunRelaunch'));
      expect(invokeMock).toHaveBeenCalledWith('relaunch_elevated');
      // режимы и настройки TUN не трогаются: это не просьба про TUN
      expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'set_system_proxy')).toEqual([]);
      view.unmount();
    });

    it('отказ в UAC и обычная учётная запись объясняются словами автозапуска', async () => {
      let answer: Promise<unknown> = Promise.resolve('cancelled');
      invokeMock.mockImplementation((cmd: string) =>
        cmd === 'relaunch_elevated' ? answer : Promise.resolve(os({ enabled: true, method: 'task' })),
      );
      await mountBare(createElement(AutostartRow));
      await click(relaunchButton());

      await click(document.querySelector('#tunRelaunch'));
      expect(dialogText()).toContain('autostart is unchanged');

      answer = Promise.reject(new Error('admin_account_required'));
      await click(document.querySelector('#tunRelaunch'));
      expect(document.querySelector('.dlg .banner-err')?.textContent).toContain(
        'Autostart with administrator rights needs an administrator account',
      );
      expect(dialogText()).not.toContain('TUN needs');
    });
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

  describe('Linux (запись автозапуска сеанса)', () => {
    it('включён: подсказка про запись сеанса, кнопки повышения нет', async () => {
      invokeMock.mockResolvedValue(
        os({ enabled: true, method: 'desktop_entry', installed: false }),
      );
      const v = await mountBare(createElement(AutostartRow));
      expect(sw(v)?.getAttribute('aria-checked')).toBe('true');
      expect(detail(v)).toContain('via a session autostart entry');
      expect(v.container.querySelector('#autostartRelaunch')).toBeNull();
    });

    it('выключен: подсказка как включается на Linux, без слов про администратора', async () => {
      invokeMock.mockResolvedValue(os({ method: 'desktop_entry', installed: false }));
      const v = await mountBare(createElement(AutostartRow));
      expect(sw(v)?.getAttribute('aria-checked')).toBe('false');
      expect(detail(v)).toContain('session autostart entry (~/.config/autostart)');
      expect(v.container.querySelector('#autostartRelaunch')).toBeNull();
    });

    it('запись не распознана: «неизвестно» словами записи, а не планировщика', async () => {
      invokeMock.mockResolvedValue(os({ unknown: true, method: 'desktop_entry', installed: false }));
      const v = await mountBare(createElement(AutostartRow));
      expect(detail(v)).toContain('could not be recognized');
      expect(detail(v)).not.toContain('scheduler');
    });
  });
});

describe('миграция Run -> задача не удалась (повышенный экземпляр, обычный автозапуск)', () => {
  const stuck = (v: { container: HTMLElement }): string =>
    v.container.querySelector('#autostartStuck')?.textContent ?? '';

  it('elevated + installed + registry: предупреждение с причиной и советом', async () => {
    invokeMock.mockResolvedValue(os({ enabled: true, method: 'registry', elevated: true, installed: true }));
    const v = await mountBare(createElement(AutostartRow));
    expect(stuck(v)).toContain('could not be moved to a scheduler task');
    expect(stuck(v)).toContain('Turn autostart off and on again');
    expect(v.container.querySelector('#autostartStuck')?.getAttribute('role')).toBe('alert');
    expect(detail(v)).not.toContain('needs a restart as administrator');
  });

  it.each([
    ['без прав', { enabled: true, method: 'registry', elevated: false, installed: true }],
    ['portable', { enabled: true, method: 'registry', elevated: true, installed: false }],
    ['задача', { enabled: true, method: 'task', elevated: true, installed: true }],
    ['выключен', { enabled: false, method: null, elevated: true, installed: true }],
  ])('предупреждения нет: %s', async (_name, state) => {
    invokeMock.mockResolvedValue(os(state));
    const v = await mountBare(createElement(AutostartRow));
    expect(v.container.querySelector('#autostartStuck')).toBeNull();
  });
});
