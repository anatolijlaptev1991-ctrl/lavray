// SPDX-License-Identifier: GPL-3.0-only

// ConnRule.test.tsx — «Создать правило» из строки соединения (T-80, VC):
// для встроенного активного набора предлагается копия, для своего правило
// добавляется сразу; повтор, ошибка конфликта и негодный адрес.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { RoutingPresetSchema } from '../../gen/lavray_pb';
import type { ConnectionSnapshot, RoutingPreset } from '../../gen/lavray_pb';
import { setLanguage, t, tf } from '../../lib/i18n';
import { conn, createFeed, drain, frame, mountWithCore } from '../../test-utils/connsKit';
import type { Feed, Mounted } from '../../test-utils/connsKit';
import { ConnsScreen } from './ConnsScreen';

const GLOBAL = create(RoutingPresetSchema, { id: 'global', displayName: 'preset.global', builtin: true, revision: 2 });
const MINE = create(RoutingPresetSchema, { id: 'custom:mine', displayName: 'Mine', revision: 3, directDomain: ['old.example'] });

let feed: Feed<ConnectionSnapshot>;
let host: Mounted | undefined;
const listPresets = vi.fn();
const createPreset = vi.fn();
const updatePreset = vi.fn();
const activatePreset = vi.fn();

async function open(active: RoutingPreset, rows = [conn('v', { destination: 'Video.Example.com:443' })]): Promise<void> {
  listPresets.mockResolvedValue({ presets: [GLOBAL, active.builtin ? MINE : active], activePresetId: active.id });
  const core = {
    connections: { watchConnections: feed.stream, closeConnection: vi.fn() },
    routing: { listPresets, createPreset, updatePreset, activatePreset },
  };
  host = await mountWithCore(core, createElement(ConnsScreen, { active: true }));
  feed.push(frame(rows));
  await drain();
}

async function click(el: Element | null | undefined): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

const menuItem = (label: string): HTMLElement =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent === label)!;

async function pick(label: string, row = 0): Promise<void> {
  await click(document.querySelectorAll('tbody tr')[row]?.querySelector('button.conn-menu'));
  await click(menuItem(label));
}

const note = (): string => document.querySelector('[role="status"], .banner-err')?.textContent ?? '';

describe('создать правило из соединения (T-80)', () => {
  beforeEach(() => {
    setLanguage('en');
    feed = createFeed<ConnectionSnapshot>();
    host = undefined;
    for (const fn of [listPresets, createPreset, updatePreset, activatePreset]) fn.mockReset();
    createPreset.mockImplementation(() =>
      Promise.resolve(create(RoutingPresetSchema, { id: 'custom:copy', displayName: 'Copy 1', revision: 1, builtinSourceId: 'global' })),
    );
    updatePreset.mockImplementation(({ preset }: { preset: RoutingPreset }) => Promise.resolve({ preset, needsProfileRestart: false }));
    activatePreset.mockResolvedValue({ needsProfileRestart: true });
  });
  afterEach(() => {
    host?.unmount();
    document.body.innerHTML = '';
  });

  it('rule_from_connection_offers_copy: встроенный активный набор — вопрос про копию, потом копия, правило, активация', async () => {
    await open(GLOBAL);
    await pick(t('conns.ruleDirect'));
    expect(createPreset).not.toHaveBeenCalled();
    const dlg = document.querySelector('.dlg');
    expect(dlg?.querySelector('h2')?.textContent).toBe(t('conns.ruleCopy.t'));
    expect(dlg?.querySelector('p')?.textContent).toBe(tf('conns.ruleCopy.d', { name: 'Global', rule: 'full:video.example.com' }));

    await click([...document.querySelectorAll('.dlg button')].find((b) => b.textContent === t('conns.ruleCopy.ok')));
    expect(createPreset).toHaveBeenCalledWith({ builtinSourceId: 'global' });
    const sent = updatePreset.mock.calls[0]?.[0] as { preset: RoutingPreset; expectedRevision: number };
    expect(sent.expectedRevision).toBe(1);
    expect(sent.preset.directDomain).toEqual(['full:video.example.com']);
    expect(sent.preset.displayName).toBe(tf('rt.copyName', { name: 'Global' }));
    expect(activatePreset).toHaveBeenCalledWith({ id: 'custom:copy' });
    expect(note()).toBe(tf('conns.ruleAddedRestart', { name: tf('rt.copyName', { name: 'Global' }) }));
    expect(document.querySelector('.dlg')).toBeNull();
  });

  it('«Отмена» в вопросе про копию ничего не создаёт', async () => {
    await open(GLOBAL);
    await pick(t('conns.ruleProxy'));
    await click([...document.querySelectorAll('.dlg button')].find((b) => b.textContent === t('common.cancel')));
    expect(createPreset).not.toHaveBeenCalled();
    expect(updatePreset).not.toHaveBeenCalled();
    expect(document.querySelector('.dlg')).toBeNull();
  });

  it('свой набор: запись уходит в нужный список с проверкой ревизии, вопроса нет', async () => {
    await open(MINE, [conn('v', { destination: 'video.example.com:443' }), conn('i', { destination: '93.184.216.34:443' })]);
    await pick(t('conns.ruleProxy'));
    expect(document.querySelector('.dlg')).toBeNull();
    let sent = updatePreset.mock.calls[0]?.[0] as { preset: RoutingPreset; expectedRevision: number };
    expect(sent.expectedRevision).toBe(3);
    expect(sent.preset.proxyDomain).toEqual(['full:video.example.com']);
    expect(sent.preset.directDomain).toEqual(['old.example']);
    expect(note()).toBe(tf('conns.ruleAdded', { name: 'Mine' }));

    await pick(t('conns.ruleDirect'), 1);
    sent = updatePreset.mock.calls[1]?.[0] as { preset: RoutingPreset; expectedRevision: number };
    expect(sent.preset.directIp).toEqual(['93.184.216.34/32']);
  });

  it('повторное правило ничего не отправляет и сообщает об этом', async () => {
    await open(create(RoutingPresetSchema, { ...MINE, directDomain: ['Full:Old.Example'] }), [conn('o', { destination: 'old.example:443' })]);
    await pick(t('conns.ruleDirect'));
    expect(updatePreset).not.toHaveBeenCalled();
    expect(note()).toBe(tf('conns.ruleExists', { name: 'Mine' }));
  });

  it('конфликт ревизий (ABORTED) — сообщение «повторите правку»', async () => {
    updatePreset.mockRejectedValue(new ConnectError('stale', Code.Aborted));
    await open(MINE);
    await pick(t('conns.ruleDirect'));
    expect(note()).toBe(t('toast.presetConflict'));
  });

  it('адрес, для которого правило не составить, — пунктов «Создать правило» нет', async () => {
    await open(MINE, [conn('b', { destination: 'bad host:80' })]);
    await click(document.querySelector('tbody tr button.conn-menu'));
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent);
    expect(labels).toEqual([t('conns.copy'), t('conns.close')]);
  });
});
