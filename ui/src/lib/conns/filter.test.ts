// SPDX-License-Identifier: GPL-3.0-only

// filter.test.ts — чипы «Все / Прокси / Напрямую / Блок» и поиск (T-79).
import { describe, expect, it } from 'vitest';
import { Connection_Status } from '../../gen/lavray_pb';
import type { Connection } from '../../gen/lavray_pb';
import { conn } from '../../test-utils/connsKit';
import { CONN_CHIPS, filterConns, finalOutbound, kindOf } from './filter';

const proxied = conn('p', { destination: 'Video.Example.com:443', outbound: 'proxy-fra', chain: ['g-1', 'proxy-fra'] });
const direct = conn('d', { destination: 'intranet.local:80', outbound: 'direct', chain: ['direct'] });
const bypass = conn('y', { destination: 'ya.ru:443', outbound: 'bypass', chain: ['bypass'] });
const blockedByTag = conn('b1', { destination: 'ads.example:443', outbound: 'block', chain: ['block'] });
const blockedByStatus = conn('b2', { destination: 'x.example:443', status: Connection_Status.BLOCKED });
const noChain = conn('n', { destination: 'old.example:443', outbound: 'direct', chain: [] });
const ALL: readonly Connection[] = [proxied, direct, bypass, blockedByTag, blockedByStatus, noChain];

const idsOf = (list: readonly Connection[]): string[] => list.map((c) => c.id);

describe('filter: чипы', () => {
  it('набор чипов: Все, Прокси, Напрямую, Блок', () => {
    expect(CONN_CHIPS).toEqual(['all', 'proxy', 'direct', 'block']);
  });

  it('«Все» возвращает список как есть', () => {
    expect(filterConns(ALL, 'all', '')).toBe(ALL);
  });

  it('«Прокси» — всё, что не прямое и не блок, в том числе через группу', () => {
    expect(idsOf(filterConns(ALL, 'proxy', ''))).toEqual(['p']);
  });

  it('«Напрямую» — итоговый исходящий direct или bypass, без цепочки — по outbound', () => {
    expect(idsOf(filterConns(ALL, 'direct', ''))).toEqual(['d', 'y', 'n']);
  });

  it('«Блок» — исходящий block либо статус BLOCKED', () => {
    expect(idsOf(filterConns(ALL, 'block', ''))).toEqual(['b1', 'b2']);
  });

  it('итоговым считается последний в цепочке, а не выбранный правилом', () => {
    const viaDirectGroup = conn('g', { outbound: 'g-1', chain: ['g-1', 'direct'] });
    expect(finalOutbound(viaDirectGroup)).toBe('direct');
    expect(kindOf(viaDirectGroup)).toBe('direct');
    expect(kindOf(conn('h', { outbound: 'direct', chain: ['direct', 'proxy-fra'] }))).toBe('proxy');
  });

  it('закрытое соединение классифицируется так же (CLOSED не делает его «прокси»)', () => {
    const closedDirect = conn('c', { outbound: 'direct', chain: ['direct'], status: Connection_Status.CLOSED });
    expect(kindOf(closedDirect)).toBe('direct');
    const closedBlocked = conn('c2', { outbound: 'proxy', status: Connection_Status.BLOCKED });
    expect(kindOf(closedBlocked)).toBe('block');
  });
});

describe('filter: поиск', () => {
  it('пустой и пробельный запрос возвращает всё', () => {
    expect(filterConns(ALL, 'all', '')).toBe(ALL);
    expect(filterConns(ALL, 'all', '   ')).toBe(ALL);
  });

  it('регистр не важен ни в запросе, ни в данных', () => {
    expect(idsOf(filterConns(ALL, 'all', 'VIDEO.example'))).toEqual(['p']);
    expect(idsOf(filterConns(ALL, 'all', 'video.EXAMPLE'))).toEqual(['p']);
  });

  it('ищет по адресу и по резолвленному адресу', () => {
    const resolved = conn('r', { destination: '1.2.3.4:443', resolvedDestination: 'cdn.Resolved.net' });
    expect(idsOf(filterConns([proxied, resolved], 'all', '1.2.3.4'))).toEqual(['r']);
    expect(idsOf(filterConns([proxied, resolved], 'all', 'resolved.NET'))).toEqual(['r']);
  });

  it('ищет по цепочке, исходящему, правилу и процессу', () => {
    const rich = conn('rich', {
      outbound: 'out-main',
      chain: ['first-hop', 'out-main'],
      rule: 'domain_suffix=example => route(first-hop)',
      process: 'Firefox.exe',
    });
    const other = conn('other');
    const list = [rich, other];
    expect(idsOf(filterConns(list, 'all', 'first-hop'))).toEqual(['rich']); // звено цепочки
    expect(idsOf(filterConns(list, 'all', 'first-hop out-main'))).toEqual(['rich']); // цепочка целиком
    expect(idsOf(filterConns(list, 'all', 'OUT-MAIN'))).toEqual(['rich']); // исходящий
    expect(idsOf(filterConns(list, 'all', 'domain_suffix'))).toEqual(['rich']); // правило
    expect(idsOf(filterConns(list, 'all', 'firefox'))).toEqual(['rich']); // процесс
  });

  it('чип и поиск работают вместе', () => {
    expect(idsOf(filterConns(ALL, 'direct', 'ya.ru'))).toEqual(['y']);
    expect(filterConns(ALL, 'proxy', 'ya.ru')).toEqual([]);
  });

  it('не нашлось — пустой список; порядок найденного сохраняется', () => {
    expect(filterConns(ALL, 'all', 'нет такого')).toEqual([]);
    expect(idsOf(filterConns(ALL, 'all', 'example'))).toEqual(['p', 'b1', 'b2', 'n']);
  });

  it('входной список не изменяется', () => {
    const input = Object.freeze([...ALL]);
    filterConns(input, 'proxy', 'video');
    expect(idsOf(input)).toEqual(idsOf(ALL));
  });
});
