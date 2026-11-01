// SPDX-License-Identifier: GPL-3.0-only

// presetDraft.test.ts — чистая логика правки набора (T-80, VU).
import { describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { Outbound, RoutingPresetSchema } from '../gen/lavray_pb';
import {
  addEntry,
  applyPatch,
  isChanged,
  newProcessRule,
  parseProcessNames,
  removeEntry,
} from './presetDraft';

const base = create(RoutingPresetSchema, {
  id: 'custom:a',
  displayName: 'A',
  revision: 3,
  directDomain: ['a.example'],
  builtinSourceId: 'global',
  builtinSourceRevision: 2,
});

describe('applyPatch / isChanged', () => {
  it('патч меняет только названное и не трогает исходный набор', () => {
    const next = applyPatch(base, { lists: { proxyDomain: ['p.example'] }, defaultOutbound: Outbound.BLOCK, displayName: '  B  ' });
    expect(next.proxyDomain).toEqual(['p.example']);
    expect(next.directDomain).toEqual(['a.example']);
    expect(next.defaultOutbound).toBe(Outbound.BLOCK);
    expect(next.displayName).toBe('B');
    expect(base.proxyDomain).toEqual([]);
    expect(next.id).toBe('custom:a');
    expect(next.builtinSourceId).toBe('global');
  });

  it('пустая правка и правка полей ядра — «не изменено»', () => {
    expect(isChanged(base, applyPatch(base, {}))).toBe(false);
    expect(isChanged(base, applyPatch(base, { displayName: 'A', lists: { directDomain: ['a.example'] } }))).toBe(false);
    expect(isChanged(base, create(RoutingPresetSchema, { ...base, revision: 9, sourceUpdated: true }))).toBe(false);
    expect(isChanged(base, applyPatch(base, { lists: { directDomain: ['a.example', 'b.example'] } }))).toBe(true);
    expect(isChanged(base, applyPatch(base, { displayName: 'Другое' }))).toBe(true);
  });
});

describe('addEntry / removeEntry', () => {
  it('добавляет в конец, повтор без учёта регистра и пустая строка — нет', () => {
    expect(addEntry(['a'], ' b ')).toEqual({ kind: 'added', list: ['a', 'b'] });
    expect(addEntry(['Ads.Example'], 'ads.example')).toEqual({ kind: 'exists' });
    expect(addEntry(['a'], '   ')).toEqual({ kind: 'empty' });
  });

  it('удаляет только указанную запись', () => {
    expect(removeEntry(['a', 'b', 'a'], 'a')).toEqual(['b']);
    expect(removeEntry(['a'], 'zzz')).toEqual(['a']);
  });
});

describe('parseProcessNames', () => {
  it('разделители — запятая, точка с запятой, пробелы; повторы без учёта регистра убираются', () => {
    expect(parseProcessNames('Chrome.exe, steam.exe;\ncurl  chrome.EXE')).toEqual({
      ok: true,
      names: ['Chrome.exe', 'steam.exe', 'curl'],
    });
  });

  it('process_rule_name_without_path (I): путь, «..» и пустой ввод отклоняются', () => {
    expect(parseProcessNames('C:\\Program Files\\a.exe')).toMatchObject({ ok: false, reason: 'path' });
    expect(parseProcessNames('bin/curl')).toMatchObject({ ok: false, reason: 'path', bad: 'bin/curl' });
    expect(parseProcessNames('..')).toMatchObject({ ok: false, reason: 'path' });
    expect(parseProcessNames(' ,; ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('(B) 64 имени проходят, 65 — нет', () => {
    const many = (n: number): string => Array.from({ length: n }, (_, i) => `p${String(i)}.exe`).join(' ');
    expect(parseProcessNames(many(64))).toMatchObject({ ok: true });
    expect(parseProcessNames(many(65))).toEqual({ ok: false, reason: 'many' });
  });
});

describe('newProcessRule', () => {
  it('*.exe — только Windows; смешанные и POSIX-имена — все платформы', () => {
    expect(newProcessRule(['a.exe', 'B.EXE'], Outbound.DIRECT).platforms).toEqual(['windows']);
    expect(newProcessRule(['a.exe', 'curl'], Outbound.PROXY).platforms).toEqual([]);
    expect(newProcessRule(['curl'], Outbound.BLOCK).outbound).toBe(Outbound.BLOCK);
  });
});
