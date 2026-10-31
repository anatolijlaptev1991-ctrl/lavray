// SPDX-License-Identifier: GPL-3.0-only

// history.test.ts — кольцевой буфер закрытых соединений: ёмкость 1000, повторы
// по id, порядок «новейшие первыми», неизменяемость (T-79).
import { describe, expect, it } from 'vitest';
import { Connection_Status } from '../../gen/lavray_pb';
import type { Connection } from '../../gen/lavray_pb';
import { conn } from '../../test-utils/connsKit';
import { clearHistory, createHistory, HISTORY_CAPACITY, pushHistory } from './history';

const closed = (id: string, endedMs: number): Connection =>
  conn(id, { status: Connection_Status.CLOSED, endedAtMs: BigInt(endedMs) });

const ids = (items: readonly Connection[]): string[] => items.map((c) => c.id);

describe('history: кольцевой буфер закрытых соединений', () => {
  it('ёмкость по умолчанию — 1000', () => {
    expect(HISTORY_CAPACITY).toBe(1000);
    expect(createHistory().capacity).toBe(1000);
  });

  it('1000 записей помещаются, 1001-я вытесняет самую старую', () => {
    let h = createHistory();
    for (let i = 1; i <= 1000; i += 1) h = pushHistory(h, [closed(`c${String(i)}`, i)]);
    expect(h.items).toHaveLength(1000);
    expect(h.items.at(-1)?.id).toBe('c1');

    h = pushHistory(h, [closed('c1001', 1001)]);
    expect(h.items).toHaveLength(1000);
    expect(h.items[0]?.id).toBe('c1001');
    expect(h.items.at(-1)?.id).toBe('c2');
    expect(h.items.some((c) => c.id === 'c1')).toBe(false);
  });

  it('пачка больше ёмкости обрезается по старым записям', () => {
    const batch = Array.from({ length: 5 }, (_, i) => closed(`b${String(i)}`, 100 - i));
    const h = pushHistory(createHistory(3), batch);
    expect(ids(h.items)).toEqual(['b0', 'b1', 'b2']);
  });

  it('повторный id не дублируется: ни между пачками, ни внутри пачки', () => {
    let h = pushHistory(createHistory(), [closed('a', 1), closed('a', 2), closed('b', 3)]);
    expect(ids(h.items).sort()).toEqual(['a', 'b']);
    const again = pushHistory(h, [closed('a', 9), closed('b', 9)]);
    expect(again).toBe(h); // ничего нового — то же состояние
    h = pushHistory(h, [closed('c', 4), closed('a', 9)]);
    expect(ids(h.items).sort()).toEqual(['a', 'b', 'c']);
    expect(h.items.find((c) => c.id === 'a')?.endedAtMs).toBe(1n); // первая запись остаётся
  });

  it('новейшие первыми: поздняя пачка выше ранней, внутри пачки — по времени закрытия', () => {
    let h = pushHistory(createHistory(), [closed('old1', 10), closed('old2', 20)]);
    h = pushHistory(h, [closed('n1', 30), closed('n2', 50), closed('n3', 40)]);
    expect(ids(h.items)).toEqual(['n2', 'n3', 'n1', 'old2', 'old1']);
  });

  it('равное время закрытия сохраняет порядок входа', () => {
    const h = pushHistory(createHistory(), [closed('x', 5), closed('y', 5), closed('z', 5)]);
    expect(ids(h.items)).toEqual(['x', 'y', 'z']);
  });

  it('clear опустошает буфер и сохраняет ёмкость', () => {
    const h = pushHistory(createHistory(7), [closed('a', 1)]);
    const cleared = clearHistory(h);
    expect(cleared.items).toEqual([]);
    expect(cleared.capacity).toBe(7);
    expect(h.items).toHaveLength(1); // прежнее состояние не изменилось
    expect(clearHistory(cleared)).toBe(cleared);
  });

  it('входные данные не изменяются, прежнее состояние остаётся прежним', () => {
    const first = Object.freeze([closed('a', 1), closed('b', 2)]);
    const before = createHistory();
    const h1 = pushHistory(before, first);
    const snapshot = [...h1.items];
    const second = Object.freeze([closed('c', 3)]);
    const h2 = pushHistory(h1, second);
    expect(before.items).toEqual([]);
    expect(h1.items).toEqual(snapshot);
    expect(ids(first)).toEqual(['a', 'b']);
    expect(ids(second)).toEqual(['c']);
    expect(h2).not.toBe(h1);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('пустая пачка возвращает то же состояние', () => {
    const h = pushHistory(createHistory(), [closed('a', 1)]);
    expect(pushHistory(h, [])).toBe(h);
  });
});
