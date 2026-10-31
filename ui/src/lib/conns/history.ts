// SPDX-License-Identifier: GPL-3.0-only

// history.ts — кольцевой буфер закрытых соединений (T-79). Ядро не хранит
// надёжной истории (ListConnections отдаёт лишь «последнее известное»), поэтому
// UI копит её сам из closedIds потока WatchConnections.
//
// Буфер неизменяемый: каждая операция возвращает новое состояние, входные
// массивы не трогаются. Порядок — «новейшие первыми»: пачка, добавленная позже,
// стоит выше предыдущих; внутри одной пачки — по времени закрытия (новее выше),
// при равенстве сохраняется порядок входа.
import type { Connection } from '../../gen/lavray_pb';

/** Сколько закрытых соединений помнит UI. */
export const HISTORY_CAPACITY = 1000;

export interface ClosedHistory {
  /** Новейшие первыми. */
  readonly items: readonly Connection[];
  readonly capacity: number;
}

export function createHistory(capacity: number = HISTORY_CAPACITY): ClosedHistory {
  return { items: [], capacity: Math.max(1, Math.floor(capacity)) };
}

const endedAt = (c: Connection): bigint => c.endedAtMs ?? 0n;

function byEndedDesc(a: Connection, b: Connection): number {
  const x = endedAt(a);
  const y = endedAt(b);
  if (x === y) return 0;
  return x > y ? -1 : 1;
}

/** Только новые id: уже известные буферу и повторы внутри пачки отбрасываются. */
function freshOnly(known: ReadonlySet<string>, conns: readonly Connection[]): Connection[] {
  const seen = new Set(known);
  const fresh: Connection[] = [];
  for (const c of conns) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    fresh.push(c);
  }
  return fresh;
}

/**
 * Кладёт закрытые соединения в начало буфера; при переполнении вытесняются самые
 * старые. Повторная отправка того же id ничего не меняет (запись остаётся на
 * прежнем месте), поэтому push идемпотентен.
 */
export function pushHistory(history: ClosedHistory, conns: readonly Connection[]): ClosedHistory {
  const fresh = freshOnly(new Set(history.items.map((c) => c.id)), conns);
  if (fresh.length === 0) return history;
  fresh.sort(byEndedDesc);
  return {
    capacity: history.capacity,
    items: [...fresh, ...history.items].slice(0, history.capacity),
  };
}

/** Пустой буфер той же ёмкости (тот же объект, если он и так пуст). */
export function clearHistory(history: ClosedHistory): ClosedHistory {
  return history.items.length === 0 ? history : createHistory(history.capacity);
}
