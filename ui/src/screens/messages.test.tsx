// messages.test.tsx — T-59: тексты ошибок и сообщения об успехе на экранах.
// Монтируются настоящие компоненты; методы RPC-клиентов подменяются.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import {
  GetTailResponseSchema,
  GroupSchema,
  ListProfilesResponseSchema,
  ListSubscriptionsResponseSchema,
} from '../gen/lavray_pb';
import { ConnRight } from '../components/ConnRight';
import { ImportDialog } from '../components/ImportDialog';
import { CoreContext } from '../hooks/useCore';
import { createCoreClients, type CoreClients } from '../lib/core';
import { setLanguage } from '../lib/i18n';
import { LogScreen } from './screen_log';
import { SubscriptionsScreen } from './screen_subscriptions';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** Подменить метод клиента (клиенты connect — обычные объекты). */
function stub(target: object, name: string, fn: unknown): void {
  (target as Record<string, unknown>)[name] = fn;
}

async function flush(ms = 25): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  });
}

async function mount(clients: CoreClients, element: ReactElement): Promise<HTMLDivElement> {
  const el = document.createElement('div');
  document.body.append(el);
  host = el;
  root = createRoot(el);
  act(() => {
    root?.render(createElement(CoreContext.Provider, { value: clients }, element));
  });
  await flush();
  return el;
}

async function click(el: Element | null | undefined): Promise<void> {
  expect(el, 'элемент для клика не найден').toBeTruthy();
  act(() => {
    (el as HTMLElement).click();
  });
  await flush();
}

function typeInto(input: HTMLInputElement | null, value: string): void {
  expect(input, 'поле ввода не найдено').toBeTruthy();
  // Нативный setter value в обход трекера React: иначе onChange не сработает.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const networkDown = (): ConnectError => ConnectError.from(new TypeError('Failed to fetch'));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  setLanguage('ru');
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
  setLanguage('en');
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

describe('T-59: ошибки не показываются сырым ключом', () => {
  // ImportDialog рисуется порталом в document.body (T-06), поэтому ищем через document.
  it('ImportDialog: ядро недоступно -> переведённый баннер, а не core.unavailable', async () => {
    const clients = createCoreClients('http://127.0.0.1:1');
    stub(clients.profiles, 'importContent', vi.fn(() => Promise.reject(networkDown())));
    await mount(
      clients,
      createElement(ImportDialog, { groupId: 1n, onClose: vi.fn(), onImported: vi.fn() }),
    );
    typeInto(document.querySelector<HTMLInputElement>('#impLink'), 'vless://u@example.org:443#S1');
    await click(document.querySelector('.dlg-f .btn-pri'));
    const banner = document.querySelector('.banner-err');
    expect(banner?.getAttribute('role')).toBe('alert');
    expect(banner?.textContent).toContain('Ядро недоступно');
    expect(banner?.textContent).not.toContain('core.unavailable');
  });

  it('ConnRight: ошибка проверки утечек переведена, а не сырой текст исключения', async () => {
    const clients = createCoreClients('http://127.0.0.1:1');
    stub(clients.diagnostics, 'checkLeaks', vi.fn(() => Promise.reject(networkDown())));
    stub(clients.stats, 'subscribe', async function* (): AsyncGenerator<never> {
      /* пустой поток */
    });
    const el = await mount(
      clients,
      createElement(ConnRight, { connected: true, presetName: '—', presetRules: 0 }),
    );
    const err = el.querySelector('.toast-err');
    expect(err?.getAttribute('role')).toBe('alert');
    expect(err?.textContent).toContain('Ядро недоступно');
    expect(err?.textContent).not.toContain('Failed to fetch');
  });

  it('заглушка RPC (Unimplemented) не маскируется под «Ядро недоступно»', async () => {
    const clients = createCoreClients('http://127.0.0.1:1');
    stub(
      clients.profiles,
      'importContent',
      vi.fn(() => Promise.reject(new ConnectError('RPC запланирован (W6)', Code.Unimplemented))),
    );
    await mount(
      clients,
      createElement(ImportDialog, { groupId: 1n, onClose: vi.fn(), onImported: vi.fn() }),
    );
    typeInto(document.querySelector<HTMLInputElement>('#impLink'), 'vless://u@example.org:443#S1');
    await click(document.querySelector('.dlg-f .btn-pri'));
    const text = document.querySelector('.banner-err')?.textContent ?? '';
    expect(text).toContain('Функция пока не реализована');
    expect(text).not.toContain('Ядро недоступно');
  });
});

describe('T-59: сообщения подписок не вводят в заблуждение', () => {
  function subsClients(): CoreClients {
    const clients = createCoreClients('http://127.0.0.1:1');
    const group = create(GroupSchema, { id: 5n, name: 'prov.example' });
    stub(
      clients.subscriptions,
      'listSubscriptions',
      vi.fn(() => Promise.resolve(create(ListSubscriptionsResponseSchema, { groups: [group] }))),
    );
    stub(
      clients.profiles,
      'listProfiles',
      vi.fn(() => Promise.resolve(create(ListProfilesResponseSchema, { total: 3n }))),
    );
    return clients;
  }

  it('после создания пустой подписки: «добавлена», а не «обновлена»; обновление не вызывалось', async () => {
    const clients = subsClients();
    const created = create(GroupSchema, { id: 7n, name: 'new.example' });
    stub(clients.subscriptions, 'createSubscription', vi.fn(() => Promise.resolve(created)));
    const updateSubscription = vi.fn();
    stub(clients.subscriptions, 'updateSubscription', updateSubscription);
    const el = await mount(clients, createElement(SubscriptionsScreen));

    await click(el.querySelector('.sub-add'));
    typeInto(el.querySelector<HTMLInputElement>('input.input'), 'https://new.example/sub');
    await click(el.querySelector('.sub-card .btn-pri'));

    const status = el.querySelector('.toast-ok');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toBe('Подписка «new.example» добавлена');
    expect(updateSubscription).not.toHaveBeenCalled();
  });
});

describe('T-59: сообщение об успехе не повторяет подпись кнопки', () => {
  it('Журнал: после копирования — «Журнал скопирован», а не подпись кнопки', async () => {
    const clients = createCoreClients('http://127.0.0.1:1');
    stub(
      clients.logs,
      'getTail',
      vi.fn(() => Promise.resolve(create(GetTailResponseSchema, { lines: [] }))),
    );
    stub(clients.logs, 'subscribe', async function* (): AsyncGenerator<never> {
      /* пустой поток */
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => Promise.resolve()) },
      configurable: true,
    });
    const el = await mount(clients, createElement(LogScreen));

    const copy = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Копировать');
    await click(copy);

    const status = el.querySelector('.toast-ok');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toBe('Журнал скопирован');
  });
});

// Статические проверки: не зависят от разметки экранов и ловят возврат дефекта
// в любом экране, в том числе в тех, что появятся позже.
const uiSources = import.meta.glob<string>(
  ['../screens/*.tsx', '../components/*.tsx', '!../**/*.test.tsx'],
  { query: '?raw', import: 'default', eager: true },
);

describe('T-59: правила для сообщений в исходниках', () => {
  it('сообщение об успехе не берётся из подписи кнопки (common.save, log.exportBtn, bk.restore …)', () => {
    const offenders: string[] = [];
    const re = /\bset(?:Ok|Msg)\(\s*t\('(common\.[A-Za-z]+|log\.exportBtn|log\.copy|bk\.restore|bk\.export|rt\.customizeCopy|dns\.adv)'\)/g;
    for (const [file, text] of Object.entries(uiSources)) {
      for (const m of text.matchAll(re)) offenders.push(`${file}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('каждое .toast-ok — live-регион role="status", каждое .toast-err — role="alert"', () => {
    const offenders: string[] = [];
    const checks: readonly [RegExp, string][] = [
      [/className="toast-ok"(?![^>]*\brole=)/, 'toast-ok без role'],
      [/className="toast-err"(?![^>]*\brole=)/, 'toast-err без role'],
    ];
    for (const [file, text] of Object.entries(uiSources)) {
      for (const [re, what] of checks) {
        if (re.test(text)) offenders.push(`${file}: ${what}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('сырой текст исключения не попадает в состояние ошибки (setErr(e.message) / setErr(String(e)))', () => {
    const offenders: string[] = [];
    const re = /\bset(?:Err|Error)\(\s*(?:e|e2|err)\s+instanceof\s+Error|\bset(?:Err|Error)\(\s*String\(\s*(?:e|e2|err)\s*\)\s*\)|\bset(?:Err|Error)\(\s*(?:e|e2|err)\.message\s*\)/g;
    for (const [file, text] of Object.entries(uiSources)) {
      for (const m of text.matchAll(re)) offenders.push(`${file}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});
