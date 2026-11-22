// SPDX-License-Identifier: GPL-3.0-only

// presetNames.test.tsx — названия пресетов на экранах «Правила», «Подключение»
// и в онбординге (T-41). Ответ ListPresets — как его отдаёт ядро: displayName
// встроенного пресета — ключ «preset.<id>».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { OnboardingDialog } from '../components/dialogs';
import { setLanguage, t } from '../lib/i18n';
import {
  click,
  connectedStatus,
  mount,
  profile,
  profileList,
  stubCore,
  unmountAll,
} from '../test-utils/coreStub';
import type { Json } from '../test-utils/coreStub';
import { ConnectionScreen } from './screen_connection';
import { RulesScreen } from './rules/RulesScreen';

const builtin = (id: string, revision: number, lists: Json = {}): Json => ({
  id,
  displayName: `preset.${id}`,
  builtin: true,
  revision,
  ...lists,
});

const LIST_PRESETS: Json = {
  presets: [
    builtin('lav-ru', 2, {
      proxyDomain: ['openai.com', 'anthropic.com'],
      directDomain: ['geosite:category-ru'],
      directIp: ['geoip:ru', 'geoip:private'],
    }),
    builtin('lav-cn', 2, { directDomain: ['geosite:cn'], directIp: ['geoip:cn'] }),
    builtin('global', 1, { directIp: ['geoip:private'] }),
    builtin('all-proxy', 1),
    builtin('all-direct', 1, { blockDomain: ['geosite:category-ads-all'] }),
  ],
  activePresetId: 'global',
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
});

describe('карточки пресетов на экране «Правила»', () => {
  const cards = (container: HTMLElement): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>('.preset'));
  const part = (card: HTMLElement, sel: string): string => card.querySelector(sel)?.textContent ?? '';

  it('en: названия, бейдж «Built-in», описание и «N rules / rev N» вместо сырых ключей', async () => {
    setLanguage('en');
    stubCore({ 'RoutingService/ListPresets': LIST_PRESETS });
    const view = await mount(createElement(RulesScreen));

    const list = cards(view.container);
    expect(list.map((c) => part(c, 'h3'))).toEqual([
      'LAV Preset RU',
      'LAV Preset CN',
      'Global',
      'Route everything through the proxy',
      'Route everything directly',
    ]);
    expect(part(list[0]!, '.badge-soft')).toBe('Built-in');
    expect(part(list[0]!, '.desc')).toBe(t('preset.lavru.desc', 'en'));
    expect(part(list[0]!, '.meta')).toBe('5 rulesrev 2');
    expect(view.container.querySelector('.preset-grid')?.textContent).not.toMatch(/preset\.|builtin/);
  });

  it('ru: названия по-русски, счётчик правил склоняется (5 правил, 2 правила, 1 правило)', async () => {
    setLanguage('ru');
    stubCore({ 'RoutingService/ListPresets': LIST_PRESETS });
    const view = await mount(createElement(RulesScreen));

    const list = cards(view.container);
    expect(list.map((c) => part(c, 'h3')).slice(2)).toEqual([
      'Глобальный',
      'Всё через прокси',
      'Всё напрямую',
    ]);
    expect(part(list[0]!, '.badge-soft')).toBe('Встроенный');
    expect([0, 1, 2].map((i) => part(list[i]!, '.badge-info'))).toEqual([
      '5 правил',
      '2 правила',
      '1 правило',
    ]);
  });

  it('пресет роутера lav-openwrt показывается именем и с описанием, а не сырым id', async () => {
    setLanguage('ru');
    stubCore({
      'RoutingService/ListPresets': {
        presets: [
          builtin('lav-openwrt', 1, {
            directDomain: ['geosite:category-ru', 'geosite:riot'],
            directIp: ['geoip:ru', 'geoip:private'],
          }),
          builtin('global', 1),
        ],
        activePresetId: 'lav-openwrt',
      },
    });
    const view = await mount(createElement(RulesScreen));

    const list = cards(view.container);
    expect(list.map((c) => part(c, 'h3'))).toEqual(['LAV Preset OpenWrt', 'Глобальный']);
    expect(part(list[0]!, '.desc')).toBe(t('preset.lavow.desc', 'ru'));
    expect(part(list[0]!, '.badge-soft')).toBe('Встроенный');
    // Активен ровно один набор: подсвечена одна карточка.
    expect(view.container.querySelectorAll('.preset.on')).toHaveLength(1);
    expect(view.container.querySelector('.preset.on h3')?.textContent).toBe('LAV Preset OpenWrt');
    expect(view.container.querySelector('.preset-grid')?.textContent).not.toMatch(/lav-openwrt|preset\./);
  });

  it('описание LAV Preset RU называет системы, для которых он сделан', async () => {
    setLanguage('ru');
    stubCore({ 'RoutingService/ListPresets': LIST_PRESETS });
    const view = await mount(createElement(RulesScreen));

    expect(part(cards(view.container)[0]!, '.desc')).toMatch(/^Для Windows и Linux\./);
  });
});

describe('название активного пресета в других местах', () => {
  it('карточка «Качество связи» на «Подключении»: «Global · 1 rule», а не «preset.global»', async () => {
    setLanguage('en');
    stubCore({
      'CoreService/GetStatus': connectedStatus('1', 'S1'),
      'ProfileService/ListProfiles': profileList(profile('1', 'S1')),
      'RoutingService/ListPresets': LIST_PRESETS,
    });
    const view = await mount(createElement(ConnectionScreen));

    const cell = view.container.querySelector('#healthCard .hl-cell:last-child .val');
    expect(cell?.textContent).toBe('Global · 1 rule');
  });

  it('онбординг: плитки шага «Маршруты» и итог последнего шага — названия, а не ключи', async () => {
    setLanguage('en');
    stubCore({ 'RoutingService/ListPresets': LIST_PRESETS });
    await mount(createElement(OnboardingDialog, { onClose: vi.fn(), onOpenImport: vi.fn() }));
    // T-06: онбординг на портале в body, поэтому ищем по документу, а не внутри container.
    const next = (): HTMLElement | undefined =>
      Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Next');

    await click(next());
    await click(next()); // шаг 3 «Маршруты»
    const tiles = Array.from(document.querySelectorAll('.onb-preset')).map((b) => b.textContent);
    expect(tiles).toEqual([
      'LAV Preset RU',
      'LAV Preset CN',
      'Global',
      'Route everything through the proxy',
      'Route everything directly',
    ]);

    await click(next()); // шаг 4: итог
    expect(document.querySelector('.onb-summary')?.textContent).toContain('Global');
    expect(document.querySelector('.onb-summary')?.textContent).not.toContain('preset.');
  });
});
