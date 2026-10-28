// ImportDialog.test.tsx — импорт: группа назначения (T-07).
// Диалог, открытый из «Подключения» или меню титлбара, не знает группу и
// не должен слать targetGroupId=0 (ядро отвечало invalid_argument).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import { createRoot } from 'react-dom/client';
import App from '../App';
import { ImportContentResponseSchema } from '../gen/lavray_pb';
import { ConnectionScreen } from '../screens/screen_connection';
import { ServersScreen } from '../screens/screen_servers';
import { setLanguage } from '../lib/i18n';
import type { CoreClients } from '../lib/core';
import {
  DEFAULT_GROUP_ID,
  buttonByText,
  click,
  flush,
  makeClients,
  mountWithCore,
  profileOf,
  typeInto,
} from '../test-harness';

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
