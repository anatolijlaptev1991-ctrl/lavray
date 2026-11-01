// SPDX-License-Identifier: GPL-3.0-only

// ConnsScreen.test.tsx — экран «Соединения» (T-79): чипы и поиск, таблица и её
// заголовки, байты, статусы, меню строки (копирование, закрытие), пауза, пустое
// состояние, ошибка потока, отключение. Ядро подставное; один тест идёт через
// настоящие клиенты и разбор protojson (stubCore).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { Code, ConnectError } from '@connectrpc/connect';
import { Connection_Status } from '../../gen/lavray_pb';
import type { ConnectionSnapshot } from '../../gen/lavray_pb';
import { formatBytes, setLanguage } from '../../lib/i18n';
import { conn, createFeed, drain, frame, mountWithCore, tick } from '../../test-utils/connsKit';
import type { Feed, Mounted } from '../../test-utils/connsKit';
import { flush, mount as mountReal, stubCore, unmountAll } from '../../test-utils/coreStub';
import { StreamReply } from '../../test-utils/streamStub';
import { ConnsScreen } from './ConnsScreen';

let feed: Feed<ConnectionSnapshot>;
let closeConnection: ReturnType<typeof vi.fn>;
let host: Mounted | undefined;

const screen = (active = true): ReturnType<typeof createElement> => createElement(ConnsScreen, { active });

async function open(active = true): Promise<Mounted> {
  const core = { connections: { watchConnections: feed.stream, closeConnection } };
  host = await mountWithCore(core, screen(active));
  return host;
}

const rows = (): HTMLTableRowElement[] => Array.from(document.querySelectorAll('tbody tr'));
const cells = (row: Element | undefined): string[] =>
  Array.from(row?.querySelectorAll('td') ?? []).map((td) => td.textContent ?? '');
const destinations = (): string[] => rows().map((r) => r.querySelector('td')?.textContent?.split(' · ')[0] ?? '');
const chipButton = (name: string): HTMLButtonElement =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('.chip')).find((b) => b.textContent === name)!;
const search = (): HTMLInputElement => document.querySelector<HTMLInputElement>('input[type="search"]')!;
const banner = (): Element | null => document.querySelector('[role="alert"]');

async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
    await Promise.resolve();
  });
}

async function typeIn(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    // Нативный сеттер value: React-овский счётчик значения иначе не заметит смену.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

async function push(snap: ConnectionSnapshot): Promise<void> {
  feed.push(snap);
  await drain();
}

const MIXED = [
  conn('p', { destination: 'video.example.com:443', outbound: 'proxy-fra', chain: ['g-1', 'proxy-fra'] }),
  conn('d', { destination: 'intranet.local:80', outbound: 'direct', chain: ['direct'] }),
  conn('k', { destination: 'ads.example:443', outbound: 'block', chain: ['block'], status: Connection_Status.BLOCKED }),
];

describe('экран «Соединения» (T-79)', () => {
  beforeEach(() => {
    setLanguage('en');
    feed = createFeed<ConnectionSnapshot>();
    closeConnection = vi.fn(() => Promise.resolve({}));
    host = undefined;
  });
  afterEach(() => {
    host?.unmount();
    unmountAll();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'clipboard');
    document.body.innerHTML = '';
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('table_has_headers: настоящая таблица, у каждого заголовка scope="col" и имя', async () => {
    await open();
    await push(frame(MIXED));
    const table = document.querySelector('table');
    expect(table).not.toBeNull();
    const heads = Array.from(document.querySelectorAll('thead th'));
    expect(heads.map((th) => th.textContent)).toEqual([
      'Address', 'Outbound', 'Rule', 'Network', '↑ Upload', '↓ Download', 'Duration', 'Status', 'Actions',
    ]);
    for (const th of heads) expect(th.getAttribute('scope')).toBe('col');
    expect(rows()).toHaveLength(3);
    expect(rows().every((r) => r.querySelectorAll('td').length === heads.length)).toBe(true);
  });

  it('строка: адрес, цепочка по ходу трафика, правило, сеть, байты, длительность', async () => {
    await open();
    await push(
      frame([
        conn('x', {
          destination: 'video.example.com:443',
          process: 'firefox.exe',
          chain: ['g-1', 'proxy-fra'],
          rule: 'domain_suffix => route(g-1)',
          network: 'udp',
          startedAtMs: 1_000n,
          uploadBytes: 1500n,
          downloadBytes: 2_500_000n,
        }),
      ]),
    );
    const [first, chain, rule, network, up, down] = cells(rows()[0]);
    expect(first).toBe('video.example.com:443 · firefox.exe');
    expect(chain).toBe('g-1 → proxy-fra');
    expect(rule).toBe('domain_suffix => route(g-1)');
    expect(network).toBe('udp');
    expect(up).toBe('1.5 KB');
    expect(down).toBe('2.5 MB');
  });

  it('bytes_formatted: байты показываются единицами текущего языка', async () => {
    await open();
    await push(frame([conn('b', { uploadBytes: 999n, downloadBytes: 3_200_000_000n })]));
    expect(cells(rows()[0]).slice(4, 6)).toEqual([formatBytes(999, 'en'), formatBytes(3_200_000_000, 'en')]);
    expect(cells(rows()[0])[4]).toBe('999 B');
    expect(cells(rows()[0])[5]).toBe('3.2 GB');
    act(() => {
      setLanguage('ru');
    });
    expect(cells(rows()[0])[5]).toBe('3,2 ГБ');
  });

  it('chips_have_aria_pressed: у каждого чипа aria-pressed, нажат ровно один', async () => {
    await open();
    await push(frame(MIXED));
    const chips = Array.from(document.querySelectorAll<HTMLButtonElement>('.chip'));
    expect(chips.map((c) => c.textContent)).toEqual(['All', 'Proxy', 'Direct', 'Block']);
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
    await click(chipButton('Direct'));
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false']);
    expect(chips.filter((c) => c.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  it('chips_filter_by_outbound: «Прокси», «Напрямую», «Блок» отбирают строки, «Все» возвращает всё', async () => {
    await open();
    await push(frame(MIXED));
    expect(destinations()).toEqual(['video.example.com:443', 'intranet.local:80', 'ads.example:443']);
    await click(chipButton('Proxy'));
    expect(destinations()).toEqual(['video.example.com:443']);
    await click(chipButton('Direct'));
    expect(destinations()).toEqual(['intranet.local:80']);
    await click(chipButton('Block'));
    expect(destinations()).toEqual(['ads.example:443']);
    await click(chipButton('All'));
    expect(destinations()).toHaveLength(3);
  });

  it('chips_filter_by_outbound: чип применяется и к закрытым', async () => {
    await open();
    await push(frame(MIXED));
    await push(frame([MIXED[0]!], ['d', 'k']));
    expect(destinations()).toEqual(['video.example.com:443', 'intranet.local:80', 'ads.example:443']);
    await click(chipButton('Direct'));
    expect(destinations()).toEqual(['intranet.local:80']);
  });

  it('search_filters_destination: поиск без учёта регистра, сброс возвращает всё', async () => {
    await open();
    await push(frame(MIXED));
    await typeIn(search(), 'VIDEO.example');
    expect(destinations()).toEqual(['video.example.com:443']);
    await typeIn(search(), 'нет такого');
    expect(rows()).toHaveLength(0);
    expect(document.querySelector('.empty-d')?.textContent).toBe('No connections match');
    await typeIn(search(), '');
    expect(rows()).toHaveLength(3);
  });

  it('search_filters_destination: ищет и по цепочке, и по процессу, и по правилу', async () => {
    await open();
    await push(frame([conn('z', { process: 'Telegram.exe', rule: 'geosite=telegram => proxy', chain: ['hop-a', 'hop-b'] }), conn('y')]));
    await typeIn(search(), 'hop-a');
    expect(rows()).toHaveLength(1);
    await typeIn(search(), 'TELEGRAM.EXE');
    expect(rows()).toHaveLength(1);
    await typeIn(search(), 'geosite');
    expect(rows()).toHaveLength(1);
  });

  it('empty_state_is_not_an_error: пустой список — обычное сообщение, без баннера ошибки', async () => {
    await open(true);
    await push(frame([]));
    expect(rows()).toHaveLength(0);
    expect(document.querySelector('.empty-d')?.textContent).toBe(
      'No connections yet. They will appear as soon as apps use the network',
    );
    expect(banner()).toBeNull();
    expect(document.querySelector('.banner-err')).toBeNull();
  });

  it('empty_state_is_not_an_error: без подключения — подсказка подключиться, подписки нет', async () => {
    await open(false);
    expect(feed.opens).toHaveLength(0);
    expect(document.querySelector('.empty-d')?.textContent).toBe(
      'No active connections. Connect to see where traffic goes',
    );
    expect(banner()).toBeNull();
    expect(document.querySelector('table')).toBeNull();
  });

  it('truncated_badge_text: метка «показаны только новейшие» с числом, только при truncated', async () => {
    await open();
    await push(frame([conn('a')]));
    expect(document.querySelector('.badge-warn')).toBeNull();
    await push(frame([conn('a')], [], true));
    expect(document.querySelector('.badge-warn')?.textContent).toBe('Showing only the newest 500');
    await push(frame([conn('a')], [], false));
    expect(document.querySelector('.badge-warn')).toBeNull();
  });

  it('blocked_status_icon: у заблокированного значок cancel и подпись, у закрытого — history', async () => {
    await open();
    await push(frame(MIXED));
    const status = (r: Element | undefined): Element | null | undefined => r?.querySelector('[data-status]');
    expect(status(rows()[2])?.getAttribute('data-status')).toBe('blocked');
    expect(status(rows()[2])?.querySelector('svg circle')).not.toBeNull(); // cancel: круг с чертой
    expect(status(rows()[2])?.textContent).toBe('Blocked');
    expect(status(rows()[0])?.getAttribute('data-status')).toBe('active');
    expect(status(rows()[0])?.querySelector('svg')).toBeNull();

    await push(frame([MIXED[1]!, MIXED[2]!], ['p']));
    const closedRow = rows().find((r) => r.querySelector('td')?.textContent?.startsWith('video.example'));
    expect(status(closedRow)?.getAttribute('data-status')).toBe('closed');
    expect(status(closedRow)?.querySelector('svg path[d^="M3 12a9"]')).not.toBeNull(); // history
    expect(closedRow?.classList.contains('muted')).toBe(true);
    expect(status(closedRow)?.textContent).toBe('Closed');
  });

  it('счётчики: активные и закрытые', async () => {
    await open();
    await push(frame([conn('a'), conn('b')]));
    await push(frame([conn('b')], ['a']));
    expect(document.querySelector('.log-toolbar .cap')?.textContent).toBe('Active: 1 · Closed: 1');
  });

  it('pause_freezes_list: на паузе строки замирают, «Продолжить» показывает накопленное', async () => {
    await open();
    await push(frame([conn('a')]));
    const pauseBtn = (): HTMLButtonElement =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('.log-toolbar .btn')).find((b) =>
        ['Pause', 'Resume'].includes(b.textContent ?? ''),
      )!;
    await click(pauseBtn());
    expect(pauseBtn().textContent).toBe('Resume');
    expect(document.querySelector('.badge-info')?.textContent).toBe('List frozen');
    await push(frame([conn('a'), conn('b')]));
    expect(rows()).toHaveLength(1);
    await click(pauseBtn());
    expect(pauseBtn().textContent).toBe('Pause');
    expect(rows()).toHaveLength(2);
    expect(document.querySelector('.badge-info')).toBeNull();
  });

  it('copy_address: «Копировать адрес» кладёт адрес в буфер и сообщает об этом', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await open();
    await push(frame(MIXED));
    await click(rows()[0]!.querySelector('button.conn-menu')!);
    const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
    expect(items.map((i) => i.textContent)).toEqual([
      'Copy address',
      'Create rule: direct',
      'Create rule: via proxy',
      'Close connection',
    ]);
    await click(items[0]!);
    expect(writeText).toHaveBeenCalledWith('video.example.com:443');
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Address copied');
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('copy_address: если буфер недоступен — сообщение об ошибке, не исключение', async () => {
    await open();
    await push(frame(MIXED));
    await click(rows()[1]!.querySelector('button.conn-menu')!);
    await click(document.querySelectorAll('[role="menuitem"]')[0]!);
    expect(banner()?.textContent).toBe('Could not copy the address');
  });

  it('close_calls_rpc: «Закрыть» зовёт CloseConnection с id соединения', async () => {
    await open();
    await push(frame(MIXED));
    await click(rows()[1]!.querySelector('button.conn-menu')!);
    await click(document.querySelectorAll('[role="menuitem"]')[3]!);
    expect(closeConnection).toHaveBeenCalledTimes(1);
    expect(closeConnection).toHaveBeenCalledWith({ id: 'd' });
    expect(banner()).toBeNull();
  });

  it('close_calls_rpc: у закрытого соединения пункта «Закрыть» нет', async () => {
    await open();
    await push(frame([conn('a'), conn('b')]));
    await push(frame([conn('b')], ['a']));
    const closedRow = rows().find((r) => r.classList.contains('muted'))!;
    await click(closedRow.querySelector('button.conn-menu')!);
    expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map((i) => i.textContent)).toEqual([
      'Copy address',
      'Create rule: direct',
      'Create rule: via proxy',
    ]);
  });

  it('close_not_found_is_quiet: NOT_FOUND — уже закрыто, ни баннера, ни сообщения', async () => {
    closeConnection.mockRejectedValue(new ConnectError('connection not found', Code.NotFound));
    await open();
    await push(frame(MIXED));
    await click(rows()[0]!.querySelector('button.conn-menu')!);
    await click(document.querySelectorAll('[role="menuitem"]')[3]!);
    expect(closeConnection).toHaveBeenCalledTimes(1);
    expect(banner()).toBeNull();
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.querySelector('.banner-err')).toBeNull();
  });

  it('close: другая ошибка ядра показывается', async () => {
    closeConnection.mockRejectedValue(new ConnectError('id is not a UUID', Code.InvalidArgument));
    await open();
    await push(frame(MIXED));
    await click(rows()[0]!.querySelector('button.conn-menu')!);
    await click(document.querySelectorAll('[role="menuitem"]')[3]!);
    expect(banner()?.textContent).toContain('id is not a UUID');
  });

  it('меню строки открывается и правой кнопкой мыши', async () => {
    await open();
    await push(frame(MIXED));
    await act(async () => {
      rows()[0]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 }));
      await Promise.resolve();
    });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('stream_error_banner_and_backoff: обрыв — баннер с причиной, список остаётся, повтор по таймеру', async () => {
    vi.useFakeTimers();
    await open();
    await push(frame(MIXED));
    feed.fail(new ConnectError('stream broke', Code.Unavailable));
    await drain();
    expect(banner()?.textContent).toContain('stream broke');
    expect(banner()?.textContent).toContain('Reconnecting automatically');
    expect(rows()).toHaveLength(3); // последний известный список не пропадает
    await tick(1000);
    expect(feed.opens).toHaveLength(2);
    await push(frame([conn('n')]));
    expect(banner()).toBeNull();
    // Новый поток не знает closedIds за время обрыва: пропавшие уходят в историю.
    expect(destinations()[0]).toBe('n.example.org:443');
    expect(rows().filter((r) => r.classList.contains('muted'))).toHaveLength(3);
  });

  it('disconnect_clears_history: отключение убирает строки и историю, новое подключение — с чистого листа', async () => {
    const m = await open(true);
    await push(frame([conn('a'), conn('b')]));
    await push(frame([conn('b')], ['a']));
    expect(rows()).toHaveLength(2);
    await m.rerender(screen(false));
    expect(rows()).toHaveLength(0);
    expect(document.querySelector('.empty-d')?.textContent).toContain('Connect to see');
    await m.rerender(screen(true));
    expect(rows()).toHaveLength(0);
    await push(frame([conn('c')]));
    expect(destinations()).toEqual(['c.example.org:443']);
  });

  it('unsubscribe_on_unmount: закрытие экрана обрывает запрос', async () => {
    const m = await open();
    const signal = feed.opens[0]?.signal;
    expect(signal?.aborted).toBe(false);
    m.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('по проводу: protojson с int64-строками разбирается настоящим клиентом', async () => {
    const wire = {
      active: [
        {
          id: '5b3c2f60-8a1e-4a43-9a4d-0d6b3a2f9c11',
          startedAtMs: '1700000000000',
          status: 'STATUS_ACTIVE',
          outbound: 'proxy-fra',
          destination: 'example.org:443',
          process: 'curl.exe',
          uploadBytes: '1500',
          downloadBytes: '2500000',
          network: 'tcp',
          chain: ['g-1', 'proxy-fra'],
        },
        {
          id: '0a4f7d9e-3c1b-4f5a-8e22-6b1c9d3e7a10',
          startedAtMs: '1700000001000',
          status: 'STATUS_BLOCKED',
          outbound: 'block',
          destination: 'ads.example:443',
          network: 'udp',
          chain: ['block'],
        },
      ],
      truncated: true,
    };
    stubCore({ 'ConnectionService/WatchConnections': new StreamReply([wire], { hold: true }) });
    await mountReal(screen(true));
    await flush(50);
    expect(rows()).toHaveLength(2);
    expect(cells(rows()[0]).slice(0, 7)).toEqual([
      'example.org:443 · curl.exe', 'g-1 → proxy-fra', '—', 'tcp', '1.5 KB', '2.5 MB', expect.any(String),
    ]);
    expect(rows()[1]?.querySelector('[data-status]')?.getAttribute('data-status')).toBe('blocked');
    expect(document.querySelector('.badge-warn')?.textContent).toBe('Showing only the newest 500');
  });
});
