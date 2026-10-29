// screen_connection.test.tsx — регрессионные тесты экрана «Подключение».
// Ядро — заглушка на уровне fetch (test-utils/coreStub.ts), ответы дословные.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { setLanguage } from '../lib/i18n';
import {
  Down,
  Failure,
  click,
  connectedStatus,
  idleStatus,
  mount,
  profile,
  profileList,
  stubCore,
  unmountAll,
} from '../test-utils/coreStub';
import type { CoreStub, Json } from '../test-utils/coreStub';
import { ConnectionScreen } from './screen_connection';

const invokeMock = vi.hoisted(() => vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
}

const screen = (): Promise<Awaited<ReturnType<typeof mount>>> => mount(createElement(ConnectionScreen));

beforeEach(() => {
  setLanguage('en');
  window.localStorage.clear();
  window.location.hash = '';
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
  delete (window as TauriWindow).__TAURI_INTERNALS__;
});

describe('экран «Подключение» в простое (T-04)', () => {
  it('статус простоя без activeProfileId: кнопка «Connect» и два тумблера на месте', async () => {
    const status = idleStatus();
    expect('activeProfileId' in status).toBe(false); // ядро поля не присылает
    stubCore({
      'CoreService/GetStatus': status,
      'ProfileService/ListProfiles': profileList(profile('1', 'S1'), profile('2', 'S2')),
    });
    const view = await screen();

    expect(view.container.querySelector('#cxEmpty')).toBeNull();
    const main = view.container.querySelector<HTMLButtonElement>('#cxMain .btn-lg');
    expect(main?.textContent).toBe('Connect');
    expect(main?.disabled).toBe(false);
    expect(view.container.querySelectorAll('#cxMain [role="switch"]')).toHaveLength(2);
  });

  it('серверов нет: остаётся экран «No servers yet»', async () => {
    stubCore({ 'CoreService/GetStatus': idleStatus(), 'ProfileService/ListProfiles': profileList() });
    const view = await screen();

    expect(view.container.querySelector('#cxMain')).toBeNull();
    expect(view.container.querySelector('#cxEmpty')?.textContent).toContain('No servers yet');
  });

  it('«Connect» запускает первый сервер и ставит прокси ОС', async () => {
    (window as TauriWindow).__TAURI_INTERNALS__ = {};
    const core = stubCore({
      'CoreService/GetStatus': idleStatus(),
      'ProfileService/ListProfiles': profileList(profile('1', 'S1'), profile('2', 'S2')),
    });
    const view = await screen();

    await click(view.container.querySelector('#cxMain .btn-lg'));

    expect(core.bodies('CoreService/Connect')).toEqual([
      { profileId: '1', mode: 'CONNECT_MODE_SYSTEM_PROXY' },
    ]);
    expect(invokeMock).toHaveBeenCalledWith('set_system_proxy', { enabled: true, port: 2080 });
  });

  it('CONNECTED, но профиля нет в списке: кнопка «Disconnect» всё равно показана', async () => {
    stubCore({
      'CoreService/GetStatus': connectedStatus('7', 'Gone'),
      'ProfileService/ListProfiles': profileList(profile('1', 'S1')),
    });
    const view = await screen();

    expect(view.container.querySelector('#cxMain .btn-lg')?.textContent).toBe('Disconnect');
  });

  it('«Disconnect» снимает прокси ОС, даже если RPC Disconnect упал', async () => {
    (window as TauriWindow).__TAURI_INTERNALS__ = {};
    const core = stubCore({
      'CoreService/GetStatus': connectedStatus('1', 'S1'),
      'ProfileService/ListProfiles': profileList(profile('1', 'S1')),
      'CoreService/Disconnect': new Down(),
    });
    const view = await screen();

    await click(view.container.querySelector('#cxMain .btn-lg'));

    expect(core.bodies('CoreService/Disconnect')).toHaveLength(1);
    expect(invokeMock).toHaveBeenCalledWith(
      'set_system_proxy',
      expect.objectContaining({ enabled: false }),
    );
    // Сообщение переведено, а не сырой ключ `core.unavailable`.
    const banner = view.container.querySelector('.banner-err')?.textContent ?? '';
    expect(banner).toContain('Core unavailable');
  });
});

describe('выбор сервера на экране «Подключение» (T-26)', () => {
  // S2 — самый быстрый, S3 не измерялся: порядок меню 2, 1, 3.
  const three = (): Json =>
    profileList(
      profile('1', 'S1', { testResult: { latencyMs: 120 } }),
      profile('2', 'S2', { testResult: { latencyMs: 35 } }),
      profile('3', 'S3'),
    );
  const items = (): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]'));
  /** «Имя|тип · задержка» без иконок и пустых вставок. */
  const row = (el: Element): string =>
    Array.from(el.children)
      .map((c) => (c.textContent ?? '').replace(/\s/g, ' '))
      .filter((x) => x !== '')
      .join('|');
  const trigger = (v: { container: HTMLElement }): HTMLElement | null =>
    v.container.querySelector('.srv-pick');
  const switches = (core: CoreStub): string[] =>
    core.calls.map((c) => c.rpc).filter((r) => r.endsWith('Connect') || r.endsWith('Disconnect'));

  it('карточка сервера открывает меню: по возрастанию задержки, ✓ у выбранного, «All servers…» внизу', async () => {
    stubCore({ 'CoreService/GetStatus': idleStatus(), 'ProfileService/ListProfiles': three() });
    const view = await screen();
    expect(trigger(view)?.getAttribute('aria-expanded')).toBe('false');

    await click(trigger(view));

    expect(trigger(view)?.getAttribute('aria-expanded')).toBe('true');
    expect(items().map(row)).toEqual([
      'S2|VLESS · 35 ms',
      'S1|VLESS · 120 ms',
      'S3|VLESS · —',
      'All servers…',
    ]);
    // Выбора ещё не было — отмечен первый сервер списка (S1), фокус на нём.
    expect(items().map((el) => el.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      null,
    ]);
    expect(document.activeElement).toBe(items()[1]);
  });

  it('выбор запоминается: после ухода с экрана и возврата тот же сервер, Connect запускает его', async () => {
    const core = stubCore({
      'CoreService/GetStatus': idleStatus(),
      'ProfileService/ListProfiles': three(),
    });
    const view = await screen();
    await click(trigger(view));

    await click(items()[2]); // S3

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(window.localStorage.getItem('lavray.server')).toBe('3');
    expect(view.container.querySelector('.srv-name')?.textContent).toBe('S3');
    expect(document.activeElement).toBe(trigger(view));
    expect(core.bodies('CoreService/Connect')).toEqual([]); // в простое выбор только запоминается
    view.unmount();

    const again = await screen();
    expect(again.container.querySelector('.srv-name')?.textContent).toBe('S3');
    await click(again.container.querySelector('#cxMain .btn-lg'));
    expect(core.bodies('CoreService/Connect')).toEqual([
      { profileId: '3', mode: 'CONNECT_MODE_SYSTEM_PROXY' },
    ]);
  });

  it('сохранённый сервер удалён из списка: карточка берёт первый', async () => {
    window.localStorage.setItem('lavray.server', '99');
    stubCore({ 'CoreService/GetStatus': idleStatus(), 'ProfileService/ListProfiles': three() });
    const view = await screen();

    expect(view.container.querySelector('.srv-name')?.textContent).toBe('S1');
  });

  it('при активном соединении выбор другого сервера переключает его: Disconnect, затем Connect', async () => {
    const core = stubCore({
      'CoreService/GetStatus': connectedStatus('1', 'S1'),
      'ProfileService/ListProfiles': three(),
    });
    const view = await screen();
    await click(trigger(view));

    await click(items()[0]); // S2

    expect(switches(core)).toEqual(['CoreService/Disconnect', 'CoreService/Connect']);
    expect(core.bodies('CoreService/Connect')).toEqual([
      { profileId: '2', mode: 'CONNECT_MODE_SYSTEM_PROXY' },
    ]);
    expect(window.localStorage.getItem('lavray.server')).toBe('2');
  });

  it('смена сервера сохраняет фактический режим ядра: работает TUN — новый сервер тоже в TUN', async () => {
    const core = stubCore({
      'CoreService/GetStatus': connectedStatus('1', 'S1', 'CONNECT_MODE_TUN'),
      'ProfileService/ListProfiles': three(),
    });
    const view = await screen();
    await click(trigger(view));

    await click(items()[0]); // S2

    expect(core.bodies('CoreService/Connect')).toEqual([{ profileId: '2', mode: 'CONNECT_MODE_TUN' }]);
  });

  it('новый сервер не запустился: возвращаем прежний, выбор откатывается, ошибка показана', async () => {
    const core = stubCore({
      'CoreService/GetStatus': connectedStatus('1', 'S1'),
      'ProfileService/ListProfiles': three(),
      'CoreService/Connect': (n) => (n === 0 ? new Failure('internal', 'bad config') : {}),
    });
    const view = await screen();
    await click(trigger(view));

    await click(items()[0]); // S2

    expect(core.bodies('CoreService/Connect')).toEqual([
      { profileId: '2', mode: 'CONNECT_MODE_SYSTEM_PROXY' },
      { profileId: '1', mode: 'CONNECT_MODE_SYSTEM_PROXY' },
    ]);
    expect(window.localStorage.getItem('lavray.server')).toBe('1');
    expect(view.container.querySelector('.banner-err')?.textContent).toContain('bad config');
  });

  it('клавиатура: Home/End/стрелки, Esc закрывает и возвращает фокус; «All servers…» открывает «Серверы»', async () => {
    stubCore({ 'CoreService/GetStatus': idleStatus(), 'ProfileService/ListProfiles': three() });
    const view = await screen();
    const press = (key: string): Promise<void> =>
      act(async () => {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        await Promise.resolve();
      });
    await click(trigger(view));

    await press('End');
    expect(document.activeElement).toBe(items()[3]);
    await press('Home');
    await press('ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    await press('Escape');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger(view));

    await click(trigger(view));
    await click(items()[3]);
    expect(window.location.hash).toBe('#screen=servers&tab=profiles');
  });
});

describe('режимы на экране «Подключение» (T-27)', () => {
  const connected = (mode = 'CONNECT_MODE_SYSTEM_PROXY'): Record<string, Json> => ({
    'CoreService/GetStatus': connectedStatus('1', 'S1', mode),
    'ProfileService/ListProfiles': profileList(profile('1', 'S1')),
  });
  /** [системный прокси, TUN] */
  const sw = (v: { container: HTMLElement }): HTMLElement[] =>
    Array.from(v.container.querySelectorAll<HTMLElement>('.cx-mode-row .sw'));
  const stored = (): unknown => JSON.parse(window.localStorage.getItem('lavray.modes') ?? 'null');
  const lifecycle = (core: CoreStub): string[] =>
    core.calls.map((c) => c.rpc).filter((r) => r.endsWith('Connect') || r.endsWith('Disconnect'));

  it('TUN при активном соединении: Disconnect → Connect в режиме TUN, выбор сохранён', async () => {
    const core = stubCore(connected());
    const view = await screen();

    await click(sw(view)[1]);

    expect(lifecycle(core)).toEqual(['CoreService/Disconnect', 'CoreService/Connect']);
    expect(core.bodies('CoreService/Connect')).toEqual([{ profileId: '1', mode: 'CONNECT_MODE_TUN' }]);
    expect(sw(view)[1]?.getAttribute('aria-checked')).toBe('true');
    expect(stored()).toEqual({ sysProxy: true, tunMode: true });
    expect(view.container.querySelector('#stateCard > .hint')?.textContent).toBe('Mode applied');
  });

  it('выключение TUN при работающем TUN возвращает режим системного прокси', async () => {
    window.localStorage.setItem('lavray.modes', JSON.stringify({ sysProxy: true, tunMode: true }));
    const core = stubCore(connected('CONNECT_MODE_TUN'));
    const view = await screen();

    await click(sw(view)[1]);

    expect(core.bodies('CoreService/Connect')).toEqual([
      { profileId: '1', mode: 'CONNECT_MODE_SYSTEM_PROXY' },
    ]);
    expect(sw(view)[1]?.getAttribute('aria-checked')).toBe('false');
  });

  it('TUN не запустился (нет прав): прежний режим восстановлен, переключатель и выбор откатились', async () => {
    const core = stubCore({
      ...connected(),
      'CoreService/Connect': (n) => (n === 0 ? new Failure('internal', 'access is denied') : {}),
    });
    const view = await screen();

    await click(sw(view)[1]);

    expect(core.bodies('CoreService/Connect')).toEqual([
      { profileId: '1', mode: 'CONNECT_MODE_TUN' },
      { profileId: '1', mode: 'CONNECT_MODE_SYSTEM_PROXY' },
    ]);
    expect(sw(view)[1]?.getAttribute('aria-checked')).toBe('false');
    expect(stored()).toEqual({ sysProxy: true, tunMode: false });
    expect(view.container.querySelector('.banner-err')?.textContent).toContain('access is denied');
  });

  it('системный прокси при активном соединении применяется сразу, без перезапуска ядра', async () => {
    (window as TauriWindow).__TAURI_INTERNALS__ = {};
    const core = stubCore(connected());
    const view = await screen();

    await click(sw(view)[0]); // по умолчанию включён → выключаем

    expect(invokeMock).toHaveBeenCalledWith('set_system_proxy', { enabled: false, port: 2080 });
    expect(lifecycle(core)).toEqual([]);
    expect(sw(view)[0]?.getAttribute('aria-checked')).toBe('false');
    expect(stored()).toEqual({ sysProxy: false, tunMode: false });
  });

  it('системный прокси нельзя включить вне оболочки: переключатель возвращается, причина показана', async () => {
    window.localStorage.setItem('lavray.modes', JSON.stringify({ sysProxy: false, tunMode: false }));
    stubCore(connected());
    const view = await screen();

    await click(sw(view)[0]);

    expect(sw(view)[0]?.getAttribute('aria-checked')).toBe('false');
    expect(stored()).toEqual({ sysProxy: false, tunMode: false });
    expect(view.container.querySelector('.banner-err')?.textContent).toContain('desktop app');
  });

  it('без соединения переключатели только запоминаются: ядру и оболочке ничего не уходит', async () => {
    (window as TauriWindow).__TAURI_INTERNALS__ = {};
    const core = stubCore({
      'CoreService/GetStatus': idleStatus(),
      'ProfileService/ListProfiles': profileList(profile('1', 'S1')),
    });
    const view = await screen();

    await click(sw(view)[1]);
    await click(sw(view)[0]);

    expect(stored()).toEqual({ sysProxy: false, tunMode: true });
    expect(lifecycle(core)).toEqual([]);
    // T-46: выбранный TUN в оболочке спрашивает права (`is_elevated`, только чтение).
    // Команд, меняющих систему (прокси и т.п.), по-прежнему не уходит.
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd !== 'is_elevated')).toEqual([]);
  });
});
