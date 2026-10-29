// screen_servers.test.tsx — экран «Серверы»: тест задержки, меню, копирование ссылок.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import {
  CoreState,
  CoreStatusSchema,
  ExportLinksResponseSchema,
  GroupSchema,
  Group_Kind,
  LatencyResultSchema,
  ProfileSchema,
  ProfileType,
  TestLatencyRequest_Mode,
} from '../gen/lavray_pb';
import type { Group, LatencyResult, Profile } from '../gen/lavray_pb';
import { CoreContext } from '../hooks/useCore';
import { setLanguage, t } from '../lib/i18n';
import {
  buttonByText,
  click,
  flush,
  makeClients,
  mountWithCore,
  profileOf,
  typeInto,
} from '../test-harness';
import type { CoreClients } from '../lib/core';
import { ServersScreen } from './screen_servers';

beforeEach(() => {
  setLanguage('en');
  window.localStorage.clear();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

const frame = (id: number, index: number, ms: number): LatencyResult =>
  create(LatencyResultSchema, { profileId: BigInt(id), index, total: 2, result: { latencyMs: ms } });

describe('T-22: подпись прогресса теста', () => {
  it('«Test all» показывает «Checked 1 of 2», а не шаблон с {done} и {total}', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const clients = makeClients({ profiles: [profileOf(1, 'S1'), profileOf(2, 'S2')] });
    vi.spyOn(clients.profiles, 'testLatency').mockImplementation(() =>
      (async function* (): AsyncGenerator<LatencyResult> {
        yield frame(1, 1, 40);
        await gate; // тест держит стрим открытым между кадрами
        yield frame(2, 2, 55);
      })(),
    );
    const m = await mountWithCore(clients, createElement(ServersScreen));

    await click(buttonByText(m.container, 'Test all'));
    await flush(20);
    const labels = Array.from(m.container.querySelectorAll('.prof-toolbar .cap.mono')).map(
      (e) => e.textContent ?? '',
    );
    expect(labels).toContain('Checked 1 of 2');
    expect(labels.join('|')).not.toMatch(/[{}]/);

    release();
    await flush(20);
    m.unmount();
  });
});

describe('T-24: меню режима теста без нереализованных режимов', () => {
  it('в меню ▾ только «Latency»; «Full test» скрыт, тест уходит как TCP-пинг', async () => {
    const clients = makeClients({ profiles: [profileOf(1, 'S1'), profileOf(2, 'S2')] });
    const testLatency = vi
      .spyOn(clients.profiles, 'testLatency')
      .mockImplementation(() =>
        (async function* (): AsyncGenerator<LatencyResult> {
          await Promise.resolve();
          yield frame(1, 1, 40);
        })(),
      );
    const m = await mountWithCore(clients, createElement(ServersScreen));

    await click(m.container.querySelector('button[aria-label="More tests"]'));
    const items = Array.from(m.container.querySelectorAll('[role="menuitem"]'));
    expect(items.map((i) => (i.textContent ?? '').trim())).toEqual(['Latency']);
    expect(m.container.textContent).not.toContain('Full test');

    await click(items[0]);
    expect(testLatency).toHaveBeenCalledTimes(1);
    expect(testLatency.mock.calls[0]?.[0]).toMatchObject({
      profileIds: [1n, 2n],
      mode: TestLatencyRequest_Mode.TCP_PING,
    });
    m.unmount();
  });
});

describe('T-25: «Копировать ссылку»', () => {
  const writeText = vi.fn((_text: string) => Promise.resolve());
  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  async function mountServers(links: string[]): Promise<{
    container: HTMLElement;
    exportLinks: MockInstance<CoreClients['profiles']['exportLinks']>;
    unmount: () => void;
  }> {
    const clients = makeClients({ profiles: [profileOf(1, 'S1'), profileOf(2, 'S2')] });
    const exportLinks = vi
      .spyOn(clients.profiles, 'exportLinks')
      .mockResolvedValue(create(ExportLinksResponseSchema, { links }));
    const m = await mountWithCore(clients, createElement(ServersScreen));
    return { container: m.container, exportLinks, unmount: m.unmount };
  }

  const toolbarCopy = (c: HTMLElement): HTMLButtonElement => {
    const bar = c.querySelector<HTMLElement>('.srv-actions');
    if (bar === null) throw new Error('панель действий не найдена');
    return buttonByText(bar, 'Copy link');
  };

  it('без выделения копирует ссылки видимых серверов, а не пустой запрос', async () => {
    const t = await mountServers(['vless://a', 'vless://b']);
    await click(toolbarCopy(t.container));
    expect(t.exportLinks).toHaveBeenCalledWith({ ids: [1n, 2n] });
    expect(writeText).toHaveBeenCalledWith('vless://a\nvless://b');
    expect(t.container.querySelector('.toast-ok')?.textContent).toBe('Link copied to clipboard');
    t.unmount();
  });

  it('с выделением копирует только выделенные', async () => {
    const t = await mountServers(['vless://b']);
    await click(t.container.querySelector('input[aria-label="Select S2"]'));
    await click(toolbarCopy(t.container));
    expect(t.exportLinks).toHaveBeenCalledWith({ ids: [2n] });
    t.unmount();
  });

  it('пункт меню строки копирует ссылку своей строки, даже если отмечены другие', async () => {
    const t = await mountServers(['vless://b']);
    await click(t.container.querySelector('input[aria-label="Select S1"]'));
    const moreButtons = t.container.querySelectorAll('.prow-more');
    await click(moreButtons[1]); // меню строки S2
    const menu = t.container.querySelector<HTMLElement>('[role="menu"]');
    if (menu === null) throw new Error('меню строки не открылось');
    await click(buttonByText(menu, 'Copy link'));
    expect(t.exportLinks).toHaveBeenCalledWith({ ids: [2n] });
    expect(writeText).toHaveBeenCalledWith('vless://b');
    t.unmount();
  });

  it('если у серверов нет ссылки (цепочка, custom), буфер не трогаем и показываем ошибку', async () => {
    const t = await mountServers([]);
    await click(toolbarCopy(t.container));
    expect(writeText).not.toHaveBeenCalled();
    expect(t.container.querySelector('[role="alert"]')?.textContent).toContain('no shareable link');
    t.unmount();
  });
});

describe('T-39: меню строки и режима теста с клавиатуры', () => {
  async function mountMenus(): Promise<{
    c: HTMLElement;
    more: HTMLButtonElement[];
    testLatency: MockInstance<CoreClients['profiles']['testLatency']>;
    unmount: () => void;
  }> {
    const clients = makeClients({ profiles: [profileOf(1, 'S1'), profileOf(2, 'S2')] });
    const testLatency = vi
      .spyOn(clients.profiles, 'testLatency')
      .mockImplementation(() =>
        (async function* (): AsyncGenerator<LatencyResult> {
          await Promise.resolve();
          yield frame(2, 1, 40);
        })(),
      );
    const m = await mountWithCore(clients, createElement(ServersScreen));
    const more = Array.from(m.container.querySelectorAll<HTMLButtonElement>('.prow-more'));
    return { c: m.container, more, testLatency, unmount: m.unmount };
  }

  const items = (c: HTMLElement): HTMLElement[] =>
    Array.from(c.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  const menu = (c: HTMLElement): Element | null => c.querySelector('[role="menu"]');

  function press(key: string, init: KeyboardEventInit = {}, target: Element | null = document.activeElement): void {
    if (target === null) throw new Error('press: нет цели');
    act(() => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    });
  }

  it('меню строки: фокус на первом пункте, стрелки/Home/End по кругу, буква, Esc возвращает фокус', async () => {
    const t = await mountMenus();
    const trigger = t.more[0];
    await click(trigger);
    expect(menu(t.c)?.getAttribute('aria-label')).toBe('Menu');
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    const list = items(t.c);
    expect(list.map((i) => (i.textContent ?? '').trim())).toEqual(['Copy link', 'Latency test', 'Delete']);
    expect(document.activeElement).toBe(list[0]);

    press('ArrowDown');
    expect(document.activeElement).toBe(list[1]);
    press('ArrowDown');
    press('ArrowDown'); // по кругу
    expect(document.activeElement).toBe(list[0]);
    press('ArrowUp');
    expect(document.activeElement).toBe(list[2]);
    press('Home');
    expect(document.activeElement).toBe(list[0]);
    press('End');
    expect(document.activeElement).toBe(list[2]);
    press('l'); // type-ahead: «Latency test»
    expect(document.activeElement).toBe(list[1]);

    press('Escape');
    expect(menu(t.c)).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    t.unmount();
  });

  it('Shift+F10, клавиша ContextMenu и правая кнопка на строке открывают её меню', async () => {
    const t = await mountMenus();
    const row2 = t.more[1]?.closest('li');
    const checkbox = row2?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
    checkbox?.focus();

    press('F10', { shiftKey: true }, checkbox);
    expect(menu(t.c)).not.toBeNull();
    expect(document.activeElement).toBe(items(t.c)[0]);
    press('Escape');
    expect(document.activeElement).toBe(t.more[1]); // фокус — на кнопку-открывалку строки

    press('ContextMenu', {}, checkbox);
    expect(menu(t.c)).not.toBeNull();
    press('Escape');

    act(() => {
      checkbox?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    expect(menu(t.c)).not.toBeNull();
    t.unmount();
  });

  it('пункт возвращает фокус на кнопку и запускает действие; Tab и клик вне закрывают меню', async () => {
    const t = await mountMenus();
    await click(t.more[1]);
    await click(items(t.c)[1]); // «Latency test» строки S2
    expect(menu(t.c)).toBeNull();
    expect(document.activeElement).toBe(t.more[1]);
    expect(t.testLatency.mock.calls[0]?.[0]).toMatchObject({ profileIds: [2n] });

    await click(t.more[0]);
    press('Tab');
    expect(menu(t.c)).toBeNull();
    expect(document.activeElement).toBe(t.more[0]); // дальше Tab пойдёт от кнопки

    await click(t.more[0]);
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(menu(t.c)).toBeNull();

    await click(t.more[0]);
    await click(t.more[0]); // повторный клик по кнопке закрывает, а не открывает заново
    expect(menu(t.c)).toBeNull();
    t.unmount();
  });

  it('меню режима теста: фокус на пункте, Esc возвращает фокус на «▾»', async () => {
    const t = await mountMenus();
    const chevron = t.c.querySelector<HTMLButtonElement>('button[aria-label="More tests"]');
    await click(chevron);
    expect(document.activeElement).toBe(items(t.c)[0]);
    press('Escape');
    expect(menu(t.c)).toBeNull();
    expect(document.activeElement).toBe(chevron);
    t.unmount();
  });

  it('меню зажато в пределах окна', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true });
    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('menu')) return rect(0, 0, 210, 120);
      if (this.classList.contains('prow-more')) return rect(380, 270, 28, 28);
      return rect(0, 0, 0, 0);
    });
    const t = await mountMenus();
    await click(t.more[0]); // желаемая точка: x=380−160=220, y=298+4=302 — за краем окна
    const el = menu(t.c) as HTMLElement;
    expect(el.style.left).toBe('182px'); // 400 − 210 − 8
    expect(el.style.top).toBe('172px'); // 300 − 120 − 8
    t.unmount();
  });
});

const DEFAULT_GROUP = 10n;
const SUB_GROUP = 20n;
const WORK_GROUP = 30n;
const LONG_NAME =
  '🇷🇺 Москва — очень длинное название сервера: премиум, 10 Гбит/с, без логов, anycast, резерв №2 [Reality+Vision]';

function group(id: bigint, name: string, kind: Group_Kind): Group {
  return create(GroupSchema, { id, name, kind });
}

function profile(id: number, name: string, groupId: bigint, type = ProfileType.VLESS): Profile {
  // у цепочки и custom-профиля адреса нет (он внутри JSON/узлов цепочки)
  const hasAddr = type !== ProfileType.CHAIN && type !== ProfileType.CUSTOM_OUTBOUND;
  return create(ProfileSchema, {
    id: BigInt(id),
    groupId,
    type,
    name,
    address: hasAddr ? `h${String(id)}.example.org` : '',
    port: hasAddr ? 443 : 0,
    tags: id === 1 ? ['work'] : [],
  });
}

interface Fake {
  readonly clients: CoreClients;
  readonly moveProfiles: ReturnType<typeof vi.fn>;
}

function fakeClients(state: CoreState, activeProfileId: bigint): Fake {
  const groups = [
    group(DEFAULT_GROUP, 'Default', Group_Kind.BASIC),
    group(SUB_GROUP, 'Provider sub', Group_Kind.SUBSCRIPTION),
    group(WORK_GROUP, 'Work', Group_Kind.BASIC),
  ];
  const profiles = [
    profile(1, 'Manual one', DEFAULT_GROUP),
    profile(2, 'From subscription', SUB_GROUP, ProfileType.TROJAN),
    profile(3, 'Work server', WORK_GROUP, ProfileType.HYSTERIA2),
    profile(4, LONG_NAME, DEFAULT_GROUP, ProfileType.CHAIN),
  ];
  const moveProfiles = vi.fn(() => Promise.resolve({}));
  const clients = {
    profiles: {
      listGroups: () => Promise.resolve({ groups }),
      listProfiles: () => Promise.resolve({ profiles, total: BigInt(profiles.length) }),
      moveProfiles,
    },
    core: {
      getStatus: () => Promise.resolve(create(CoreStatusSchema, { state, activeProfileId })),
    },
  } as unknown as CoreClients;
  return { clients, moveProfiles };
}

describe('ServersScreen (T-65)', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setLanguage('ru');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function mount(fake: Fake): Promise<void> {
    act(() => {
      root?.render(
        createElement(CoreContext.Provider, { value: fake.clients }, createElement(ServersScreen)),
      );
    });
    await flush();
  }

  const text = (el: Element | null | undefined): string => (el?.textContent ?? '').trim();

  const rowNames = (): string[] =>
    Array.from(container.querySelectorAll('.prow .prow-name')).map((e) => e.textContent ?? '');

  function pickFilter(label: string): void {
    const select = container.querySelector<HTMLSelectElement>('#subSel');
    const option = Array.from(select?.options ?? []).find((o) => o.text === label);
    expect(option, `пункт «${label}» в #subSel`).toBeDefined();
    act(() => {
      if (select === null || option === undefined) return;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function checkRow(name: string): void {
    const row = Array.from(container.querySelectorAll('.prow')).find(
      (r) => r.querySelector('.prow-name')?.textContent === name,
    );
    const box = row?.querySelector<HTMLInputElement>('.prow-chk');
    expect(box, `чекбокс строки «${name}»`).toBeTruthy();
    act(() => {
      box?.click();
    });
  }

  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(container.querySelectorAll('button')).find((b) => text(b) === label);

  it('фильтр «Добавлены вручную» показывает серверы групп без подписки (раньше был пуст)', async () => {
    await mount(fakeClients(CoreState.IDLE, 0n));
    expect(rowNames()).toHaveLength(4);
    pickFilter(t('srv.manual'));
    expect(rowNames().sort()).toEqual(['Manual one', 'Work server', LONG_NAME].sort());
  });

  it('при фильтре «вручную» «Добавить» открывает редактор, а не падает на BigInt', async () => {
    await mount(fakeClients(CoreState.IDLE, 0n));
    pickFilter(t('srv.manual'));
    act(() => {
      button(t('prof.add'))?.click();
    });
    expect(container.ownerDocument.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('полоса выделения: проверить, переместить, удалить, снять', async () => {
    await mount(fakeClients(CoreState.IDLE, 0n));
    expect(container.querySelector('.selbar')).toBeNull();
    checkRow('Manual one');
    const bar = container.querySelector('.selbar');
    expect(bar?.getAttribute('role')).toBe('toolbar');
    const labels = Array.from(bar?.querySelectorAll('button') ?? []).map((b) => text(b));
    expect(labels).toEqual([t('test.latency'), t('srv.move'), t('srv.delSel'), t('srv.selClear')]);
    act(() => {
      button(t('srv.selClear'))?.click();
    });
    expect(container.querySelector('.selbar')).toBeNull();
  });

  it('«Переместить в группу…» вызывает MoveProfiles для выделенных серверов', async () => {
    const fake = fakeClients(CoreState.IDLE, 0n);
    await mount(fake);
    checkRow('Manual one');
    checkRow('Work server');
    act(() => {
      button(t('srv.move'))?.click();
    });
    const items = Array.from(container.querySelectorAll('.menu [role="menuitem"]')).map((b) => text(b));
    // подписочная группа в меню не предлагается: обновление подписки стёрло бы сервер
    expect(items).toEqual(['Default', 'Work']);
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLElement>('.menu [role="menuitem"]'))
        .find((b) => text(b) === 'Default')
        ?.click();
      await Promise.resolve();
    });
    expect(fake.moveProfiles).toHaveBeenCalledTimes(1);
    expect(fake.moveProfiles).toHaveBeenCalledWith({
      ids: [1n, 3n],
      targetGroupId: DEFAULT_GROUP,
    });
  });

  it('строка: нейтральный бейдж типа, у подключённого сервера — «Активен»', async () => {
    await mount(fakeClients(CoreState.CONNECTED, 1n));
    const badges = Array.from(container.querySelectorAll('.prow .badge[class*="bt-"]')).map(
      (b) => b.textContent,
    );
    expect(badges.sort()).toEqual(['Hysteria2', 'Trojan', 'VLESS', t('ed.t.chain')].sort());
    const active = container.querySelectorAll('.prow.active');
    expect(active).toHaveLength(1);
    expect(active[0]?.querySelector('.badge-ok')?.textContent).toBe(t('srv.active'));
    expect(active[0]?.querySelector('.p-tag')?.textContent).toBe('work');
  });

  it('у цепочки адреса нет: строка не показывает «:0»', async () => {
    await mount(fakeClients(CoreState.IDLE, 0n));
    const addrs = Array.from(container.querySelectorAll('.prow-addr')).map((e) => text(e));
    expect(addrs).toHaveLength(3); // 4 строки, у цепочки адреса нет
    expect(addrs.every((a) => a.endsWith(':443'))).toBe(true);
  });

  it('без подключения бейджа «Активен» нет', async () => {
    await mount(fakeClients(CoreState.IDLE, 1n));
    expect(container.querySelector('.prow.active')).toBeNull();
    expect(container.querySelector('.prow .badge-ok')).toBeNull();
  });

  it('длинное имя: полное имя доступно в title, а не только в усечённом тексте', async () => {
    await mount(fakeClients(CoreState.IDLE, 0n));
    const main = Array.from(container.querySelectorAll<HTMLElement>('.prow-main')).find(
      (b) => b.querySelector('.prow-name')?.textContent === LONG_NAME,
    );
    expect(main?.getAttribute('title')).toBe(LONG_NAME);
    // вкладка группы: имя обёрнуто в .srv-gtab-name (там работает text-overflow), полное — в title
    const tab = container.querySelector('.srv-gtab[title="Provider sub"]');
    expect(tab?.querySelector('.srv-gtab-name')?.textContent).toBe('Provider sub');
  });
});

describe('U-01: «Добавить» при фильтре «вручную» сохраняет в не подписочную группу', () => {
  // store.DefaultGroupID из миграции ядра (ядро не меняем).
  const CORE_DEFAULT = 2147483000n;
  const SUB = 77n;
  const subFirst = (): Group[] => [
    create(GroupSchema, { id: SUB, name: 'Provider sub', kind: Group_Kind.SUBSCRIPTION }),
    create(GroupSchema, { id: CORE_DEFAULT, name: 'Default', kind: Group_Kind.BASIC }),
  ];

  beforeEach(() => {
    setLanguage('ru');
  });

  function pickManual(container: HTMLElement): void {
    const select = container.querySelector<HTMLSelectElement>('#subSel');
    const option = Array.from(select?.options ?? []).find((o) => o.text === t('srv.manual'));
    expect(option, 'пункт «Добавлены вручную» в #subSel').toBeDefined();
    act(() => {
      if (select === null || option === undefined) return;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('сохраняет с groupId группы Default, а не с подпиской, которая стоит первой в списке', async () => {
    const clients = makeClients({ groups: subFirst() });
    const createProfile = vi
      .spyOn(clients.profiles, 'createProfile')
      .mockResolvedValue(profileOf(9, 'Новый'));
    const m = await mountWithCore(clients, createElement(ServersScreen));
    pickManual(m.container);
    await click(buttonByText(m.container, t('prof.add')));
    typeInto(document.getElementById('edRemark') as HTMLInputElement | null, 'Новый');
    typeInto(document.getElementById('edAddr') as HTMLInputElement | null, 'new.example.org');
    typeInto(document.getElementById('edPort') as HTMLInputElement | null, '443');
    await click(buttonByText(document.body, t('common.save')));
    expect(createProfile).toHaveBeenCalledTimes(1);
    expect(createProfile.mock.calls[0]?.[0].profile?.groupId).toBe(CORE_DEFAULT);
    m.unmount();
  });

  it('пока список групп не загружен, «Добавить» неактивна', async () => {
    const clients = makeClients();
    vi.spyOn(clients.profiles, 'listGroups').mockRejectedValue(new Error('core offline'));
    const m = await mountWithCore(clients, createElement(ServersScreen));
    pickManual(m.container);
    expect(buttonByText(m.container, t('prof.add')).disabled).toBe(true);
    m.unmount();
  });

  it('если есть только подписочные группы, «Добавить» при фильтре «вручную» неактивна', async () => {
    const clients = makeClients({
      groups: [create(GroupSchema, { id: SUB, name: 'Provider sub', kind: Group_Kind.SUBSCRIPTION })],
    });
    const m = await mountWithCore(clients, createElement(ServersScreen));
    pickManual(m.container);
    expect(buttonByText(m.container, t('prof.add')).disabled).toBe(true);
    m.unmount();
  });
});
