// SPDX-License-Identifier: GPL-3.0-only

// RulesScreen.test.tsx — редактор наборов маршрутов (T-80, VC): сохранение
// копией, конфликт ревизий, встроенный набор только для чтения, ошибка
// «не реализовано», шесть действий меню карточки, баннер перезапуска, имена
// процессов без пути, клавиатура меню. Ядро подставное на уровне fetch
// (stubCore): запросы и разбор ответов настоящие.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { setLanguage, t, tf } from '../../lib/i18n';
import { click, Failure, flush, mount, stubCore, unmountAll } from '../../test-utils/coreStub';
import type { CoreStub } from '../../test-utils/coreStub';
import { builtinPreset, customPreset, presetKit, typeInto } from '../../test-utils/presetKit';
import type { PresetKit } from '../../test-utils/presetKit';
import { RulesScreen } from './RulesScreen';

const saveFile = vi.hoisted(() => vi.fn(() => Promise.resolve('saved')));
vi.mock('../../lib/saveFile', () => ({ saveFile }));

const GLOBAL = builtinPreset('global', { directIp: ['geoip:private'] });
const MINE = customPreset('custom:mine', 'Mine', { builtinSourceId: 'global', builtinSourceRevision: 2, directDomain: ['a.example'] });

let kit: PresetKit;
let stub: CoreStub;

async function open(list = [GLOBAL, MINE], active = 'custom:mine', extra: Parameters<typeof stubCore>[0] = {}): Promise<HTMLElement> {
  kit = presetKit(list, active);
  stub = stubCore({ ...kit.routes, ...extra });
  return (await mount(createElement(RulesScreen))).container;
}

const cards = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('.preset'));
const cardOf = (id: string): HTMLElement => cards().find((c) => c.querySelector('h3')?.textContent === id)!;
const text = (sel: string): string => document.querySelector(sel)?.textContent ?? '';
const menuItems = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
const byText = (label: string): HTMLElement => {
  const found = [...document.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.trim() === label);
  if (found === undefined) throw new Error(`нет кнопки «${label}»`);
  return found;
};

async function openCardMenu(card: HTMLElement): Promise<void> {
  await click(card.querySelector('.preset-more'));
}

beforeEach(() => {
  setLanguage('en');
  saveFile.mockClear();
});

afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('сохранение копией и создание', () => {
  it('save_as_preset_calls_create_and_shows_card', async () => {
    await open([GLOBAL], 'global');
    await click(byText(t('rt.new')));
    await click(menuItems()[0]);
    const input = document.querySelector<HTMLInputElement>('#rtName')!;
    expect(input.value).toBe(tf('rt.copyName', { name: 'Global' }));
    await typeInto(input, 'Мой набор');
    await click(byText(t('common.save')));

    expect(stub.bodies('RoutingService/CreatePreset')).toEqual([{ builtinSourceId: 'global' }]);
    const renamed = stub.bodies('RoutingService/UpdatePreset')[0] as { preset: { displayName: string }; expectedRevision: number };
    expect(renamed.preset.displayName).toBe('Мой набор');
    expect(renamed.expectedRevision).toBe(1);
    expect(stub.bodies('RoutingService/ActivatePreset')).toEqual([{ id: 'custom:copy-1' }]);
    expect(cards().map((c) => c.querySelector('h3')?.textContent)).toEqual(['Global', 'Мой набор']);
    expect(cardOf('Мой набор').classList.contains('on')).toBe(true);
    expect(text('.toast-ok')).toBe(t('toast.presetCopied'));
  });

  it('«Создать пустой»: набор из значений (выход «прокси»), пустое имя не принимается', async () => {
    await open([GLOBAL], 'global');
    await click(byText(t('rt.new')));
    await click(menuItems()[1]);
    await typeInto(document.querySelector<HTMLInputElement>('#rtName')!, '   ');
    await click(byText(t('common.create')));
    expect(text('.field-err')).toBe(t('rt.nameEmpty'));
    expect(stub.bodies('RoutingService/CreatePreset')).toHaveLength(0);

    await typeInto(document.querySelector<HTMLInputElement>('#rtName')!, 'Пустой');
    await click(byText(t('common.create')));
    const req = stub.bodies('RoutingService/CreatePreset')[0] as { builtinSourceId?: string; preset: Record<string, unknown> };
    expect(req.builtinSourceId).toBeUndefined();
    expect(req.preset).toMatchObject({ displayName: 'Пустой', defaultOutbound: 'OUTBOUND_PROXY' });
    expect(cardOf('Пустой')).toBeDefined();
  });
});

describe('ошибки ядра', () => {
  it('revision_conflict_reloads (C): ABORTED перечитывает наборы и просит повторить правку', async () => {
    await open([GLOBAL, MINE], 'custom:mine', { 'RoutingService/UpdatePreset': new Failure('aborted', 'revision 3 ≠ 4') });
    expect(stub.bodies('RoutingService/ListPresets')).toHaveLength(1);
    const input = document.querySelector<HTMLInputElement>('[data-rule-add="directDomain"] input')!;
    await typeInto(input, 'b.example');
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    expect(stub.bodies('RoutingService/UpdatePreset')).toHaveLength(1);
    expect(stub.bodies('RoutingService/ListPresets')).toHaveLength(2);
    expect(text('.banner-err')).toBe(t('toast.presetConflict'));
  });

  it('unimplemented_is_not_core_unavailable: «не реализовано» не маскируется под «Ядро недоступно»', async () => {
    await open([GLOBAL], 'global', { 'RoutingService/CreatePreset': new Failure('unimplemented', 'RPC not implemented') });
    await click(byText(t('rt.new')));
    await click(menuItems()[1]);
    await typeInto(document.querySelector<HTMLInputElement>('#rtName')!, 'X');
    await click(byText(t('common.create')));
    expect(text('.banner-err')).toBe(t('err.unimplemented'));
    expect(text('.banner-err')).not.toBe(t('core.unavailable'));
  });
});

describe('встроенный набор', () => {
  it('builtin_is_read_only: списки, правила приложений и выход не редактируются; есть «Настроить копию»', async () => {
    const lav = builtinPreset('global', {
      directDomain: ['geosite:private'],
      processRules: [{ processNames: ['cursor.exe'], outbound: 'OUTBOUND_PROXY', platforms: ['windows'] }],
    });
    await open([lav], 'global');
    expect(text('.ro-banner .t')).toBe(t('rt.ro'));
    expect(document.querySelector('.rule-add')).toBeNull();
    expect(document.querySelector('.rule-chip-x')).toBeNull();
    expect(document.querySelector<HTMLSelectElement>('#defOut')!.disabled).toBe(true);
    expect(document.querySelector('[data-proc-rule] .rule-chip')?.textContent).toBe('cursor.exe');
    expect(document.querySelector('[data-proc-rule] .rule-chip-x')).toBeNull();
    expect(document.querySelector('input[aria-label="' + t('rt.proc.names') + '"]')).toBeNull();
    expect(text('[data-proc-rule]')).toContain(t('rt.proc.winOnly'));

    await click(byText(t('rt.customizeCopy')));
    expect(stub.bodies('RoutingService/CreatePreset')).toEqual([{ builtinSourceId: 'global' }]);
    expect(stub.bodies('RoutingService/ActivatePreset')).toHaveLength(1);
    expect(stub.bodies('RoutingService/UpdatePreset')).toHaveLength(1); // имя «(копия)»
  });
});

describe('меню карточки', () => {
  it('card_menu_actions: rename → UpdatePreset с новым именем', async () => {
    await open();
    await openCardMenu(cardOf('Mine'));
    await click(menuItems().find((i) => i.textContent === t('rt.rename')));
    const input = document.querySelector<HTMLInputElement>('#rtName')!;
    expect(input.value).toBe('Mine');
    await typeInto(input, 'Новое имя');
    await click(byText(t('common.save')));
    const req = stub.bodies('RoutingService/UpdatePreset')[0] as { preset: { id: string; displayName: string }; expectedRevision: number };
    expect(req).toMatchObject({ preset: { id: 'custom:mine', displayName: 'Новое имя' }, expectedRevision: 3 });
    expect(cardOf('Новое имя')).toBeDefined();
  });

  it('card_menu_actions: duplicate → копия с именем «(копия)», без активации', async () => {
    await open();
    await openCardMenu(cardOf('Mine'));
    await click(menuItems().find((i) => i.textContent === t('rt.duplicate')));
    expect(stub.bodies('RoutingService/CreatePreset')).toEqual([{ builtinSourceId: 'custom:mine' }]);
    const renamed = stub.bodies('RoutingService/UpdatePreset')[0] as { preset: { displayName: string } };
    expect(renamed.preset.displayName).toBe(tf('rt.copyName', { name: 'Mine' }));
    expect(stub.bodies('RoutingService/ActivatePreset')).toHaveLength(0);
    expect(cards()).toHaveLength(3);
  });

  it('card_menu_actions: delete → подтверждение → DeletePreset', async () => {
    await open();
    await openCardMenu(cardOf('Mine'));
    await click(menuItems().find((i) => i.textContent === t('rt.deletePreset')));
    expect(stub.bodies('RoutingService/DeletePreset')).toHaveLength(0);
    expect(text('.dlg p')).toBe(tf('rt.deleteConfirm', { name: 'Mine' }));
    await click(document.querySelector('.dlg .btn-danger-solid'));
    expect(stub.bodies('RoutingService/DeletePreset')).toEqual([{ id: 'custom:mine' }]);
    expect(text('.toast-ok')).toBe(t('toast.presetDeleted'));
    expect(cards()).toHaveLength(1);
  });

  it('card_menu_actions: export → ExportPreset и «Сохранить как» (json)', async () => {
    await open();
    await openCardMenu(cardOf('Mine'));
    await click(menuItems().find((i) => i.textContent === t('rt.exportPreset')));
    expect(stub.bodies('RoutingService/ExportPreset')).toEqual([{ id: 'custom:mine' }]);
    expect(saveFile).toHaveBeenCalledWith('my-set', 'json', '{"exported":true}\n');
    expect(text('.toast-ok')).toBe(t('toast.presetExported'));
  });

  it('card_menu_actions: export — отмена диалога «Сохранить как» молчит', async () => {
    saveFile.mockResolvedValueOnce('cancelled');
    await open();
    await openCardMenu(cardOf('Mine'));
    await click(menuItems().find((i) => i.textContent === t('rt.exportPreset')));
    expect(document.querySelector('.toast-ok')).toBeNull();
    expect(document.querySelector('.banner-err')).toBeNull();
  });

  it('card_menu_actions: import → читает выбранный файл и зовёт ImportPreset', async () => {
    await open();
    const file = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const clicked = vi.spyOn(file, 'click').mockImplementation(() => undefined);
    await openCardMenu(cardOf('Mine'));
    await click(menuItems().find((i) => i.textContent === t('rt.importPreset')));
    expect(clicked).toHaveBeenCalled();
    Object.defineProperty(file, 'files', { value: [new File(['{"routing":{}}'], 'p.json', { type: 'application/json' })], configurable: true });
    await act(async () => {
      file.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await flush();
    expect(stub.bodies('RoutingService/ImportPreset')).toEqual([{ json: '{"routing":{}}' }]);
    expect(text('.toast-ok')).toBe(t('toast.presetImported'));
  });

  it('card_menu_actions: reset → подтверждение → ResetBuiltinPreset (пункт есть только у копии)', async () => {
    await open();
    await openCardMenu(cardOf('Mine'));
    await click(menuItems().find((i) => i.textContent === t('rt.resetSource')));
    expect(stub.bodies('RoutingService/ResetBuiltinPreset')).toHaveLength(0);
    await click(document.querySelector('.dlg .btn-pri'));
    expect(stub.bodies('RoutingService/ResetBuiltinPreset')).toEqual([{ id: 'custom:mine' }]);
    expect(text('.toast-ok')).toBe(t('toast.presetReset'));
    // У встроенного — только дублирование, экспорт и импорт.
    await openCardMenu(cardOf('Global'));
    expect(menuItems().map((i) => i.textContent)).toEqual([t('rt.duplicate'), t('rt.exportPreset'), t('rt.importPreset')]);
  });

  it('menu_keyboard_navigation (A): фокус на первом пункте, стрелки, Esc возвращает фокус на кнопку', async () => {
    await open();
    const more = cardOf('Mine').querySelector<HTMLButtonElement>('.preset-more')!;
    more.focus();
    await click(more);
    const items = menuItems();
    expect(items).toHaveLength(6);
    expect(document.activeElement).toBe(items[0]);
    const press = async (key: string): Promise<void> => {
      await act(async () => {
        (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        await Promise.resolve();
      });
    };
    await press('ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    await press('End');
    expect(document.activeElement).toBe(items[5]);
    await press('ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    await press('ArrowUp');
    expect(document.activeElement).toBe(items[5]);
    await press('Escape');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('карточка активируется Enter, а кнопка меню не активирует набор', async () => {
    await open([GLOBAL, MINE], 'global');
    await click(cardOf('Mine').querySelector('.preset-more'));
    expect(stub.bodies('RoutingService/ActivatePreset')).toHaveLength(0);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const card = cardOf('Mine');
    await act(async () => {
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    expect(stub.bodies('RoutingService/ActivatePreset')).toEqual([{ id: 'custom:mine' }]);
  });
});

describe('баннер перезапуска', () => {
  it('delete_active_shows_restart_banner: удаление активного при работающем соединении', async () => {
    await open([GLOBAL, MINE], 'custom:mine', {
      'RoutingService/DeletePreset': () => {
        kit.state.list = kit.state.list.filter((p) => p.id !== 'custom:mine');
        kit.state.active = 'global';
        return { needsProfileRestart: true, newActiveId: 'global' };
      },
    });
    await openCardMenu(cardOf('Mine'));
    await click(menuItems().find((i) => i.textContent === t('rt.deletePreset')));
    await click(document.querySelector('.dlg .btn-danger-solid'));
    expect(text('.restart-banner .t')).toBe(t('dns.restart'));
    expect(cardOf('Global').classList.contains('on')).toBe(true);

    await click(byText(t('dns.restartBtn')));
    expect(stub.bodies('CoreService/RestartProfile')).toHaveLength(1);
    expect(document.querySelector('.restart-banner')).toBeNull();
  });

  it('«Позже» скрывает баннер без перезапуска', async () => {
    await open([GLOBAL, MINE], 'custom:mine', { 'RoutingService/UpdatePreset': (_n, body) => ({ preset: (body as { preset: object }).preset, needsProfileRestart: true }) });
    const input = document.querySelector<HTMLInputElement>('[data-rule-add="blockDomain"] input')!;
    await typeInto(input, 'ads.example');
    await click(input.closest('.rule-add')!.querySelector('button'));
    expect(document.querySelector('.restart-banner')).not.toBeNull();
    await click(byText(t('dns.restartLater')));
    expect(document.querySelector('.restart-banner')).toBeNull();
    expect(stub.bodies('CoreService/RestartProfile')).toHaveLength(0);
  });
});

describe('правила для приложений', () => {
  const procInput = (): HTMLInputElement => document.querySelector<HTMLInputElement>(`input[aria-label="${t('rt.proc.names')}"]`)!;

  it('process_rule_name_without_path (I): имя с путём отклоняется на месте, запрос не уходит', async () => {
    await open();
    await typeInto(procInput(), 'C:\\Tools\\app.exe');
    await click(byText(t('rt.proc.add')));
    expect(text('.field-err')).toBe(tf('rt.proc.errPath', { name: 'C:\\Tools\\app.exe' }));
    expect(stub.bodies('RoutingService/UpdatePreset')).toHaveLength(0);
    await typeInto(procInput(), '  ');
    await click(byText(t('rt.proc.add')));
    expect(text('.field-err')).toBe(t('rt.proc.errEmpty'));
  });

  it('правильное имя сохраняется: *.exe — только Windows; удаление убирает правило', async () => {
    await open();
    await typeInto(procInput(), 'Steam.exe, game.exe');
    await click(byText(t('rt.proc.add')));
    const req = stub.bodies('RoutingService/UpdatePreset')[0] as { preset: { processRules: Record<string, unknown>[] } };
    expect(req.preset.processRules).toEqual([{ processNames: ['Steam.exe', 'game.exe'], outbound: 'OUTBOUND_DIRECT', platforms: ['windows'] }]);
    expect(text('[data-proc-rule]')).toContain(t('rt.proc.winOnly'));

    await click(document.querySelector('[data-proc-rule] .rule-chip-x'));
    const second = stub.bodies('RoutingService/UpdatePreset')[1] as { preset: { processRules?: unknown[] } };
    expect(second.preset.processRules ?? []).toEqual([]);
    expect(document.querySelector('[data-proc-rule]')).toBeNull();
  });
});
