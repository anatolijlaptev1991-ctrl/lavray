// SPDX-License-Identifier: GPL-3.0-only

// RulesScreen.sourceUpdated.test.tsx — бейдж «исходный набор обновился» у
// пользовательских копий и «Сбросить к исходному» (T-75/7.5, продолжение T-80):
// апдейтер выпустил новую ревизию встроенного набора, ядро выставило
// source_updated у копий этого набора. Бейдж только у такой копии (не у встроенного,
// не у копии другого источника, не у набора «с нуля»), сброс подтягивает правила
// источника и гасит бейдж; пока бейдж есть, копия не меняется сама.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { setLanguage, t } from '../../lib/i18n';
import { click, mount, stubCore, unmountAll } from '../../test-utils/coreStub';
import type { CoreStub } from '../../test-utils/coreStub';
import { builtinPreset, customPreset, presetKit } from '../../test-utils/presetKit';
import type { PresetKit } from '../../test-utils/presetKit';
import { RulesScreen } from './RulesScreen';

vi.mock('../../lib/saveFile', () => ({ saveFile: vi.fn(() => Promise.resolve('saved')) }));

const RU = builtinPreset('lav-ru', { revision: 3, sourceUpdated: true });
const STALE = customPreset('custom:stale', 'Stale', { builtinSourceId: 'lav-ru', builtinSourceRevision: 2, sourceUpdated: true });
const FRESH = customPreset('custom:fresh', 'Fresh', { builtinSourceId: 'lav-ru', builtinSourceRevision: 3, sourceUpdated: false });
const SCRATCH = customPreset('custom:scratch', 'Scratch');

let kit: PresetKit;
let stub: CoreStub;

async function open(): Promise<void> {
  kit = presetKit([RU, STALE, FRESH, SCRATCH], 'lav-ru');
  stub = stubCore(kit.routes);
  await mount(createElement(RulesScreen));
}

const card = (name: string): HTMLElement =>
  Array.from(document.querySelectorAll<HTMLElement>('.preset')).find((c) => c.querySelector('h3')?.textContent === name)!;
const badges = (c: HTMLElement): string[] =>
  Array.from(c.querySelectorAll('.badge-warn')).map((b) => b.textContent ?? '');
const menuItem = (label: string): HTMLElement | undefined =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((i) => i.textContent === label);

beforeEach(() => {
  setLanguage('en');
});
afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('source_updated: бейдж у копий', () => {
  it('бейдж «источник обновился» только у копии с source_updated', async () => {
    await open();
    expect(badges(card('Stale'))).toEqual([t('rt.sourceUpdated')]);
    expect(badges(card('Fresh'))).toEqual([]);
    expect(badges(card('Scratch'))).toEqual([]);
    // Встроенный набор сам «источником» не помечается, даже если пришёл с флагом.
    expect(badges(document.querySelector<HTMLElement>('.preset')!)).toEqual([]);
  });

  it('бейдж доступен скринридеру как текст карточки, а не только цветом', async () => {
    await open();
    const warn = card('Stale').querySelector('.badge-warn')!;
    expect(warn.textContent?.trim()).not.toBe('');
    expect(card('Stale').textContent).toContain(t('rt.sourceUpdated'));
  });
});

describe('сброс к источнику', () => {
  it('у копии с источником есть «Сбросить к исходному»', async () => {
    await open();
    await click(card('Stale').querySelector('.preset-more'));
    expect(menuItem(t('rt.resetSource'))).toBeDefined();
  });

  it('у набора, созданного с нуля, пункта сброса нет', async () => {
    await open();
    await click(card('Scratch').querySelector('.preset-more'));
    expect(menuItem(t('rt.resetSource'))).toBeUndefined();
  });

  it('сброс → подтверждение → ResetBuiltinPreset; после перечитывания бейджа нет', async () => {
    await open();
    stub.routes['RoutingService/ResetBuiltinPreset'] = (): Record<string, unknown> => {
      kit.state.list = kit.state.list.map((p) =>
        p.id === 'custom:stale' ? { ...p, builtinSourceRevision: 3, sourceUpdated: false } : p,
      );
      return kit.state.list.find((p) => p.id === 'custom:stale') ?? {};
    };
    await click(card('Stale').querySelector('.preset-more'));
    await click(menuItem(t('rt.resetSource')));
    expect(stub.bodies('RoutingService/ResetBuiltinPreset')).toHaveLength(0);
    await click(document.querySelector('.dlg .btn-pri'));
    expect(stub.bodies('RoutingService/ResetBuiltinPreset')).toEqual([{ id: 'custom:stale' }]);
    expect(badges(card('Stale'))).toEqual([]);
    expect(card('Stale').textContent).not.toContain(t('rt.sourceUpdated'));
  });

  it('отмена в подтверждении: сброса нет, бейдж остаётся', async () => {
    await open();
    await click(card('Stale').querySelector('.preset-more'));
    await click(menuItem(t('rt.resetSource')));
    await click(Array.from(document.querySelectorAll<HTMLButtonElement>('.dlg button')).find((b) => b.textContent === t('common.cancel')));
    expect(stub.bodies('RoutingService/ResetBuiltinPreset')).toHaveLength(0);
    expect(badges(card('Stale'))).toEqual([t('rt.sourceUpdated')]);
  });
});
