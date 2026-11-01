// SPDX-License-Identifier: GPL-3.0-only

// units.test.tsx — T-60: единицы и числа берутся из словаря и склоняются
// по правилам языка (раньше: «0 Б/s», «1 ms», «Сервер: 26», «3 правил»).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import { warmViews } from '../test-harness';
import App from '../App';
import { ConnRight } from '../components/ConnRight';
import {
  GetPublicIpResponseSchema,
  GroupSchema,
  LatencyResultSchema,
  ListGroupsResponseSchema,
  ListProfilesResponseSchema,
  ProfileSchema,
} from '../gen/lavray_pb';
import type { LatencyResult } from '../gen/lavray_pb';
import { CoreContext } from '../hooks/useCore';
import { createCoreClients, type CoreClients } from '../lib/core';
import { NB, setLanguage, t } from '../lib/i18n';
import { ServersScreen } from './screen_servers';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function stub(target: object, name: string, fn: unknown): void {
  (target as Record<string, unknown>)[name] = fn;
}

async function flush(ms = 25): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  });
}

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  const el = document.createElement('div');
  document.body.append(el);
  host = el;
  root = createRoot(el);
  act(() => {
    root?.render(element);
  });
  await flush();
  return el;
}

function withCore(clients: CoreClients, element: ReactElement): ReactElement {
  return createElement(CoreContext.Provider, { value: clients }, element);
}

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

beforeAll(warmViews, 60_000);

describe('T-60: единицы и склонения из словаря', () => {
  it('статус-бар: скорость «0 Б/с» из словаря, а не «0 Б/s»', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    window.localStorage.setItem('lavray.onboarded', '1');
    window.localStorage.setItem('lavray.lang', 'ru');
    const el = await mount(createElement(App));
    const down = el.querySelector('#statusbar .spd.dn')?.textContent ?? '';
    const up = el.querySelector('#statusbar .spd.up')?.textContent ?? '';
    expect(down).toBe(`0${NB}Б/с`);
    expect(up).toBe(`0${NB}Б/с`);
    expect(down + up).not.toContain('/s');
  });

  function serversClients(): CoreClients {
    const clients = createCoreClients('http://127.0.0.1:1');
    const profiles = [1n, 2n, 3n].map((id) =>
      create(ProfileSchema, { id, groupId: 1n, name: `S${String(id)}`, address: 'a.example', port: 443 }),
    );
    stub(
      clients.profiles,
      'listProfiles',
      vi.fn(() => Promise.resolve(create(ListProfilesResponseSchema, { profiles, total: 3n }))),
    );
    stub(
      clients.profiles,
      'listGroups',
      vi.fn(() =>
        Promise.resolve(
          create(ListGroupsResponseSchema, { groups: [create(GroupSchema, { id: 1n, name: 'Default' })] }),
        ),
      ),
    );
    stub(clients.profiles, 'testLatency', async function* (): AsyncGenerator<LatencyResult> {
      yield await Promise.resolve(
        create(LatencyResultSchema, { profileId: 1n, index: 1, total: 1, result: { latencyMs: 1 } }),
      );
    });
    return clients;
  }

  it('«Серверы»: счётчик склоняется — «3 профиля», а не «Сервер: 3»', async () => {
    const el = await mount(withCore(serversClients(), createElement(ServersScreen)));
    expect(el.querySelector('.prof-toolbar .cap.mono')?.textContent).toBe('3 профиля');
  });

  it('«Серверы»: результат теста — «1 мс» из словаря, а не «1 ms»', async () => {
    const el = await mount(withCore(serversClients(), createElement(ServersScreen)));
    const testBtn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t('test.all'));
    expect(testBtn, 'кнопка «Проверить все»').toBeTruthy();
    act(() => {
      testBtn?.click();
    });
    await flush(60);
    expect(el.querySelector('.prow-lat')?.textContent).toBe(`1${NB}мс`);
  });

  it('«Подключение»: число правил пресета склоняется («3 правила», «5 правил», «21 правило»)', async () => {
    const clients = createCoreClients('http://127.0.0.1:1');
    stub(clients.diagnostics, 'getPublicIp', vi.fn(() => Promise.resolve(create(GetPublicIpResponseSchema, { ip: '203.0.113.7' }))));
    stub(clients.stats, 'subscribe', async function* (): AsyncGenerator<never> {
      /* пустой поток */
    });
    const render = (rules: number): ReactElement =>
      withCore(clients, createElement(ConnRight, { connected: false, presetName: 'LAV', presetRules: rules }));
    const el = await mount(render(3));
    const health = (): string => el.querySelector('#healthCard .badge')?.parentElement?.textContent ?? '';
    expect(health()).toContain('3 правила');
    act(() => {
      root?.render(render(5));
    });
    expect(health()).toContain('5 правил');
    act(() => {
      root?.render(render(21));
    });
    expect(health()).toContain('21 правило');
  });
});

// Статические проверки: ловят возврат дефекта в любом экране, независимо от разметки.
const uiSources = import.meta.glob<string>(
  ['../App.tsx', '../screens/*.tsx', '../components/*.tsx', '!../**/*.test.tsx'],
  { query: '?raw', import: 'default', eager: true },
);

function offenders(re: RegExp): string[] {
  const found: string[] = [];
  for (const [file, text] of Object.entries(uiSources)) {
    for (const m of text.matchAll(re)) found.push(`${file}: ${m[0]}`);
  }
  return found;
}

describe('T-60: правила для строк в исходниках', () => {
  it('единицы не печатаются литералами: «${…} ms», «…}/s»', () => {
    expect(offenders(/\$\{[^}]+\}\s?ms\b/g)).toEqual([]);
    expect(offenders(/\}\/s\b/g)).toEqual([]);
  });

  it('число правил и серверов не склоняется вручную (rt.ruleOne/rt.ruleMany, «Сервер: N»)', () => {
    expect(offenders(/'rt\.rule(?:One|Many)'/g)).toEqual([]);
    expect(offenders(/t\('srv\.current'\)\}:/g)).toEqual([]);
  });

  it('as never в вызовах t() не нужен: ключи типизированы MessageKey', () => {
    expect(offenders(/\bt\([^()]*\bas never\)/g)).toEqual([]);
  });
});
