// SPDX-License-Identifier: GPL-3.0-only

// model.test.ts — редьюсер экрана «Соединения»: кадр → активные + история,
// пауза, сброс (T-79). Чистая логика, без React.
import { describe, expect, it } from 'vitest';
import { Connection_Status } from '../../gen/lavray_pb';
import type { Connection } from '../../gen/lavray_pb';
import { conn, frame } from '../../test-utils/connsKit';
import { connsReducer, createState, viewOf } from './model';
import type { ConnsAction, ConnsState } from './model';

const run = (actions: readonly ConnsAction[], from: ConnsState = createState()): ConnsState =>
  actions.reduce(connsReducer, from);

const feed = (active: Connection[], closedIds: string[] = [], nowMs = 5_000, truncated = false): ConnsAction => ({
  type: 'frame',
  frame: frame(active, closedIds, truncated),
  nowMs,
});

const ids = (list: readonly Connection[]): string[] => list.map((c) => c.id);

describe('model: кадры потока', () => {
  it('список активных заменяется кадром целиком', () => {
    const s = run([feed([conn('a'), conn('b')]), feed([conn('b'), conn('c')])]);
    expect(ids(viewOf(s).active)).toEqual(['b', 'c']);
  });

  it('closedIds переносят соединение в историю по последней известной копии', () => {
    const a = conn('a', { uploadBytes: 10n, downloadBytes: 20n });
    const s = run([feed([a, conn('b')]), feed([conn('b')], ['a'], 9_000)]);
    const [moved] = viewOf(s).closed.items;
    expect(ids(viewOf(s).closed.items)).toEqual(['a']);
    expect(moved?.status).toBe(Connection_Status.CLOSED);
    expect(moved?.endedAtMs).toBe(9_000n); // времени закрытия не было — время кадра
    expect(moved?.uploadBytes).toBe(10n);
    expect(moved?.downloadBytes).toBe(20n);
    expect(ids(viewOf(s).active)).toEqual(['b']);
  });

  it('готовое endedAtMs сохраняется, BLOCKED остаётся BLOCKED', () => {
    const withEnd = conn('e', { endedAtMs: 1_234n });
    const blocked = conn('k', { status: Connection_Status.BLOCKED, outbound: 'block', chain: ['block'] });
    const s = run([feed([withEnd, blocked]), feed([], ['e', 'k'])]);
    const byId = new Map(viewOf(s).closed.items.map((c) => [c.id, c]));
    expect(byId.get('e')?.endedAtMs).toBe(1_234n);
    expect(byId.get('k')?.status).toBe(Connection_Status.BLOCKED);
  });

  it('неизвестный id в closedIds (не видели в прошлом кадре) игнорируется', () => {
    const s = run([feed([conn('a')]), feed([conn('a')], ['ghost'])]);
    expect(viewOf(s).closed.items).toEqual([]);
  });

  it('кадр без изменений ничего не добавляет и не ломает историю', () => {
    const s1 = run([feed([conn('a'), conn('b')]), feed([conn('b')], ['a'])]);
    const s2 = run([feed([conn('b')]), feed([conn('b')])], s1);
    expect(ids(viewOf(s2).closed.items)).toEqual(['a']);
    expect(ids(viewOf(s2).active)).toEqual(['b']);
  });

  it('повторный closedIds того же соединения не дублирует запись', () => {
    const s = run([feed([conn('a')]), feed([], ['a']), feed([], ['a'])]);
    expect(ids(viewOf(s).closed.items)).toEqual(['a']);
  });

  it('соединение, пропавшее из полного списка без closedIds (после переподключения), уходит в историю', () => {
    const s = run([feed([conn('a'), conn('b')]), feed([conn('b')])]);
    expect(ids(viewOf(s).closed.items)).toEqual(['a']);
  });

  it('при truncated пропавшее без closedIds в историю не идёт: оно просто не поместилось', () => {
    const s = run([feed([conn('a'), conn('b')]), feed([conn('b')], [], 5_000, true)]);
    expect(viewOf(s).closed.items).toEqual([]);
    expect(viewOf(s).truncated).toBe(true);
  });

  it('nowMs модели — время последнего кадра', () => {
    expect(viewOf(run([feed([], [], 4_000), feed([], [], 8_000)])).nowMs).toBe(8_000);
  });
});

describe('model: пауза и сброс', () => {
  it('пауза замораживает показ, а модель продолжает принимать кадры', () => {
    let s = run([feed([conn('a')]), { type: 'pause', paused: true }]);
    s = run([feed([conn('a'), conn('b')]), feed([conn('b')], ['a'])], s);
    expect(ids(viewOf(s).active)).toEqual(['a']); // на экране прежний снимок
    expect(viewOf(s).closed.items).toEqual([]);
    expect(ids(s.live.active)).toEqual(['b']); // а история копилась
    expect(ids(s.live.closed.items)).toEqual(['a']);

    s = run([{ type: 'pause', paused: false }], s);
    expect(s.frozen).toBeNull();
    expect(ids(viewOf(s).active)).toEqual(['b']);
    expect(ids(viewOf(s).closed.items)).toEqual(['a']);
  });

  it('повторная пауза не подменяет снимок', () => {
    const s = run([feed([conn('a')]), { type: 'pause', paused: true }, feed([conn('z')]), { type: 'pause', paused: true }]);
    expect(ids(viewOf(s).active)).toEqual(['a']);
  });

  it('снятие паузы без паузы ничего не меняет', () => {
    const s = run([feed([conn('a')])]);
    expect(connsReducer(s, { type: 'pause', paused: false })).toBe(s);
  });

  it('сброс очищает список, историю и паузу', () => {
    const s = run([feed([conn('a')]), feed([], ['a']), { type: 'pause', paused: true }, { type: 'reset' }]);
    expect(viewOf(s).active).toEqual([]);
    expect(viewOf(s).closed.items).toEqual([]);
    expect(s.frozen).toBeNull();
  });

  it('редьюсер не изменяет прежнее состояние', () => {
    const s0 = run([feed([conn('a')])]);
    const activeBefore = s0.live.active;
    connsReducer(s0, feed([], ['a']));
    expect(s0.live.active).toBe(activeBefore);
    expect(s0.live.closed.items).toEqual([]);
  });
});
