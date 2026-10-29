// SPDX-License-Identifier: GPL-3.0-only

// ImportDialog.test.tsx — импорт: группа назначения (T-07).
// Диалог, открытый из «Подключения» или меню титлбара, не знает группу и
// не должен слать targetGroupId=0 (ядро отвечало invalid_argument).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock, MockInstance } from 'vitest';
import { act, createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import App from '../App';
import { ImportContentResponse_ContentKind, ImportContentResponseSchema } from '../gen/lavray_pb';
import { ConnectionScreen } from '../screens/screen_connection';
import { ServersScreen } from '../screens/screen_servers';
import { setLanguage, t, tf } from '../lib/i18n';
import { CoreContext } from '../hooks/useCore';
import type { CoreClients } from '../lib/core';
import {
  DEFAULT_GROUP_ID,
  buttonByText,
  click,
  flush,
  groupOf,
  makeClients,
  mountWithCore,
  profileOf,
  typeInto,
} from '../test-harness';
import { ImportDialog } from './ImportDialog';

const LINK = 'vless://b831381d-6324-4d53-ad4f-8cda48b30811@example.org:443#T07';

type ImportFn = CoreClients['profiles']['importContent'];
type ImportSpy = MockInstance<ImportFn>;

/** importContent: превью отдаёт один профиль, коммит — его id. */
function stubImport(clients: CoreClients): ImportSpy {
  return vi.spyOn(clients.profiles, 'importContent').mockImplementation((req) =>
    Promise.resolve(
      req.previewOnly === true
        ? create(ImportContentResponseSchema, { parsedProfiles: [profileOf(0, 'T07')] })
        : create(ImportContentResponseSchema, { addedProfileIds: [101n] }),
    ),
  );
}

/** Вводит ссылку, жмёт «Import» (превью) и «Add» (коммит); возвращает запрос коммита. */
async function importThroughDialog(
  container: HTMLElement,
  spy: ImportSpy,
): Promise<Parameters<ImportFn>[0] | undefined> {
  // T-06: диалог рендерится порталом вне контейнера.
  const dialog = container.ownerDocument.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog === null) throw new Error('диалог импорта не открыт');
  typeInto(dialog.querySelector<HTMLInputElement>('#impLink'), LINK);
  await click(buttonByText(dialog, 'Import'));
  await click(buttonByText(dialog, 'Add'));
  await flush(20);
  return spy.mock.calls.map(([req]) => req).find((req) => req.previewOnly !== true);
}

describe('T-07: импорт без выбранной группы', () => {
  beforeEach(() => {
    setLanguage('en');
    window.localStorage.clear();
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('«Подключение» → «Добавить сервер»: группа не передаётся (раньше 0)', async () => {
    const clients = makeClients({ profiles: [profileOf(1, 'S1')] });
    const spy = stubImport(clients);
    const m = await mountWithCore(clients, createElement(ConnectionScreen));
    await click(buttonByText(m.container, 'Add server'));
    expect(m.container.ownerDocument.querySelector('#impLink')).not.toBeNull();
    const commit = await importThroughDialog(m.container, spy);
    expect(commit).toBeDefined();
    expect(commit).not.toHaveProperty('targetGroupId');
    m.unmount();
  });

  it('«Серверы»: пока список групп пуст, импорт идёт без targetGroupId', async () => {
    const clients = makeClients({ groups: [] });
    const spy = stubImport(clients);
    const m = await mountWithCore(clients, createElement(ServersScreen));
    await click(buttonByText(m.container, 'Import'));
    const commit = await importThroughDialog(m.container, spy);
    expect(commit).toBeDefined();
    expect(commit).not.toHaveProperty('targetGroupId');
    m.unmount();
  });

  it('«Серверы»: при загруженных группах импорт идёт в первую группу списка', async () => {
    const clients = makeClients({ profiles: [profileOf(1, 'S1')] });
    const spy = stubImport(clients);
    const m = await mountWithCore(clients, createElement(ServersScreen));
    await click(buttonByText(m.container, 'Import'));
    const commit = await importThroughDialog(m.container, spy);
    expect(commit?.targetGroupId).toBe(DEFAULT_GROUP_ID);
    m.unmount();
  });

  it('App: онбординг → «v2rayN» → ссылка: на проводе нет targetGroupId (раньше "0")', async () => {
    // App сам создаёт клиентов ядра, поэтому подменяем сетевой уровень.
    const importBodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const json = (status: number, body: unknown): Promise<Response> =>
          Promise.resolve(
            new Response(JSON.stringify(body), {
              status,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        if (!url.endsWith('/ImportContent')) {
          return json(503, { code: 'unavailable', message: 'stub' });
        }
        // connect-web шлёт JSON-тело как Uint8Array.
        const raw = init?.body;
        const body = typeof raw === 'string' ? raw : ArrayBuffer.isView(raw) ? new TextDecoder().decode(raw) : '';
        importBodies.push(body);
        return body.includes('"previewOnly":true')
          ? json(200, {
              parsedProfiles: [
                { id: '0', name: 'T07', address: 'example.org', port: 443, type: 'PROFILE_TYPE_VLESS' },
              ],
            })
          : json(200, { addedProfileIds: ['101'] });
      }),
    );
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query === '(prefers-color-scheme: dark)',
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(createElement(App));
    });
    await flush(50);

    // Первый запуск показывает онбординг; шаг «Сервер» ведёт в импорт.
    await click(buttonByText(document.body, 'Next'));
    const source = Array.from(document.querySelectorAll<HTMLElement>('.onb-src')).find((e) =>
      (e.textContent ?? '').includes('v2rayN'),
    );
    await click(source);
    const dialog = document.querySelector<HTMLElement>('#impTitle')?.closest<HTMLElement>('[role="dialog"]');
    if (dialog === null || dialog === undefined) throw new Error('диалог импорта не открыт');
    const linkTab = Array.from(dialog.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (e) => e.textContent === 'Link',
    );
    await click(linkTab);
    typeInto(dialog.querySelector<HTMLInputElement>('#impLink'), LINK);
    await click(buttonByText(dialog, 'Import'));
    await click(buttonByText(dialog, 'Add'));
    await flush(30);

    // Два запроса: превью и коммит; оба — с телом, а не пустой строкой.
    expect(importBodies).toHaveLength(2);
    const commit = importBodies.find((b) => !b.includes('"previewOnly":true'));
    expect(commit).toContain('"content"');
    expect(commit).not.toContain('targetGroupId');
    act(() => {
      root.unmount();
    });
  });
});

describe('T-19: ссылка на подписку и Happ', () => {
  beforeEach(() => {
    setLanguage('en');
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  const footer = (dialog: HTMLElement): string[] =>
    Array.from(dialog.querySelectorAll('.dlg-f button')).map((b) => (b.textContent ?? '').trim());

  /** Открывает диалог; ядро на превью отвечает видом kind (профилей нет). */
  async function openWithKind(
    kind: ImportContentResponse_ContentKind,
    link: string,
  ): Promise<{
    dialog: HTMLElement;
    importContent: ImportSpy;
    createSubscription: MockInstance<CoreClients['subscriptions']['createSubscription']>;
    onImported: Mock;
  }> {
    const clients = makeClients();
    const importContent = vi
      .spyOn(clients.profiles, 'importContent')
      .mockResolvedValue(create(ImportContentResponseSchema, { kind }));
    const createSubscription = vi
      .spyOn(clients.subscriptions, 'createSubscription')
      .mockResolvedValue(groupOf(5n, 'x'));
    const onImported = vi.fn();
    const m = await mountWithCore(
      clients,
      createElement(ImportDialog, { onClose: vi.fn(), onImported }),
    );
    // T-06: диалог на портале в body, а не внутри container.
    const dialog = m.container.ownerDocument.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog === null) throw new Error('диалог импорта не открыт');
    typeInto(dialog.querySelector<HTMLInputElement>('#impLink'), link);
    expect(footer(dialog)).toEqual(['Cancel', 'Import']);
    await click(buttonByText(dialog, 'Import'));
    return { dialog, importContent, createSubscription, onImported };
  }

  it.each([
    ['URL с портом и путём', 'https://panel.example.com:8443/sub/TOKEN'],
    ['Happ-ссылка', 'happ://crypt/abc'],
  ])('%s: ядро сказало SUBSCRIPTION_URL — кнопка «Add subscription», createSubscription', async (_n, link) => {
    const t = await openWithKind(ImportContentResponse_ContentKind.SUBSCRIPTION_URL, link);
    expect(footer(t.dialog)).toEqual(['Cancel', 'Add subscription']);
    expect(t.dialog.querySelector('.imp-prev-list')).toBeNull();
    expect(t.dialog.textContent).toContain('Subscription link');
    typeInto(t.dialog.querySelector<HTMLInputElement>('#impName'), 'My sub');
    await click(buttonByText(t.dialog, 'Add subscription'));
    expect(t.createSubscription).toHaveBeenCalledWith({ name: 'My sub', url: link });
    expect(t.importContent).toHaveBeenCalledTimes(1); // только превью: профиль не создаётся
    expect(t.onImported).toHaveBeenCalledTimes(1);
  });

  it('SHARE_LINKS: после превью кнопка «Add», поля имени подписки нет', async () => {
    const t = await openWithKind(ImportContentResponse_ContentKind.SHARE_LINKS, 'https://1.2.3.4:8443');
    expect(footer(t.dialog)).toEqual(['Cancel', 'Add']);
    expect(t.dialog.querySelector('#impName')).toBeNull();
  });
});

const CLIP_LINK = 'vless://12345678-90ab-cdef-1234-567890abcdef@nl01.example.net:443?security=tls#Amsterdam-a1b2';
const HAPP_LINK = 'happ://crypt3/AAAABBBBCCCC-broken';

interface Fake {
  readonly clients: CoreClients;
  readonly importContent: Mock<(req: { content: string }) => Promise<{ parsedProfiles: never[]; customFieldWarnings: never[] }>>;
}

function fakeClients(rejectWith?: Error): Fake {
  const importContent = vi.fn((_req: { content: string }) =>
    rejectWith === undefined
      ? Promise.resolve({ parsedProfiles: [], customFieldWarnings: [] })
      : Promise.reject(rejectWith),
  );
  const clients = { profiles: { importContent } } as unknown as CoreClients;
  return { clients, importContent };
}

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

describe('ImportDialog (T-67)', () => {
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
    setClipboard(undefined);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function open(fake: Fake): Promise<void> {
    act(() => {
      root?.render(
        createElement(
          CoreContext.Provider,
          { value: fake.clients },
          createElement(ImportDialog, { groupId: 10n, onClose: vi.fn(), onImported: vi.fn() }),
        ),
      );
    });
    await flush();
  }

  const text = (el: Element | null | undefined): string => (el?.textContent ?? '').trim();
  const link = (): HTMLInputElement => document.getElementById('impLink') as HTMLInputElement;
  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(document.querySelectorAll('button')).find((b) => text(b) === label);

  function typeLink(value: string): void {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(link(), value);
      link().dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function click(el: HTMLElement | undefined): Promise<void> {
    await act(async () => {
      el?.click();
      await Promise.resolve();
    });
    await flush();
  }

  it('в буфере ссылка — плашка с маской, «Вставить» подставляет ссылку в поле', async () => {
    setClipboard({ readText: vi.fn(() => Promise.resolve(`  ${CLIP_LINK}\n`)), writeText: vi.fn() });
    await open(fakeClients());
    const banner = document.querySelector('.banner-warn');
    expect(banner).not.toBeNull();
    const expected = tf('imp.clip', { link: 'vless://…a1b2' });
    expect(text(banner?.querySelector('.bn-t span'))).toBe(expected);
    expect(text(banner)).toContain(t('imp.clipNote'));
    // ссылку целиком (хост, uuid) плашка не показывает
    expect(text(banner)).not.toContain('nl01.example.net');
    expect(link().value).toBe('');

    await click(button(t('imp.clipPaste')));
    expect(link().value).toBe(CLIP_LINK);
    expect(document.querySelector('.banner-warn')).toBeNull();
  });

  it('«Скрыть» убирает плашку и ничего не вставляет', async () => {
    setClipboard({ readText: vi.fn(() => Promise.resolve(CLIP_LINK)) });
    await open(fakeClients());
    expect(document.querySelector('.banner-warn')).not.toBeNull();
    await click(button(t('imp.clipHide')));
    expect(document.querySelector('.banner-warn')).toBeNull();
    expect(link().value).toBe('');
  });

  it('плашки нет: Clipboard API недоступен, в буфере не ссылка, доступ запрещён', async () => {
    setClipboard(undefined);
    await open(fakeClients());
    expect(document.querySelector('.banner-warn')).toBeNull();

    act(() => {
      root?.unmount();
    });
    root = createRoot(container);
    setClipboard({ readText: vi.fn(() => Promise.resolve('просто текст, не ссылка')) });
    await open(fakeClients());
    expect(document.querySelector('.banner-warn')).toBeNull();

    act(() => {
      root?.unmount();
    });
    root = createRoot(container);
    setClipboard({ readText: vi.fn(() => Promise.reject(new Error('NotAllowedError'))) });
    await open(fakeClients());
    expect(document.querySelector('.banner-warn')).toBeNull();
  });

  it('ошибка Happ: карточка с деталями, «Копировать детали» и «Повторить»', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ readText: vi.fn(() => Promise.resolve('')), writeText });
    const fake = fakeClients(new Error('[invalid_argument] happ: decrypt failed — tag mismatch'));
    await open(fake);
    typeLink(HAPP_LINK);
    await click(button(t('imp.do')));

    const card = document.querySelector('.errcard');
    expect(card).not.toBeNull();
    expect(text(card?.querySelector('.t'))).toBe(t('imp.happErrT'));
    expect(text(card?.querySelector('.ctx'))).toBe(t('imp.happErrCtx'));
    const details = card?.querySelector('.d')?.textContent ?? '';
    expect(details).toContain('decrypt failed');
    expect(details).toContain(`source: happ://… · ${String(HAPP_LINK.length)} B`);
    expect(details).not.toContain('AAAABBBBCCCC'); // ссылка целиком в детали не попадает
    // вместо общей красной плашки — только карточка
    expect(document.querySelector('.banner-err')).toBeNull();

    await click(button(t('err.copyDetails')));
    expect(writeText).toHaveBeenCalledWith(details);
    expect(text(document.querySelector('.toast-ok'))).toBe(t('err.copied'));

    await click(button(t('err.retry')));
    expect(fake.importContent).toHaveBeenCalledTimes(2);
    expect(fake.importContent.mock.calls[1]?.[0].content).toBe(HAPP_LINK);

    // правка ссылки убирает карточку
    typeLink(`${HAPP_LINK}x`);
    expect(document.querySelector('.errcard')).toBeNull();
  });

  it('не-Happ ссылка с ошибкой по-прежнему даёт общую плашку, без карточки Happ', async () => {
    const fake = fakeClients(new Error('[invalid_argument] unsupported link'));
    await open(fake);
    typeLink('vless://broken');
    await click(button(t('imp.do')));
    expect(document.querySelector('.errcard')).toBeNull();
    expect(text(document.querySelector('.banner-err'))).toContain('unsupported link');
  });
});
