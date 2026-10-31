// SPDX-License-Identifier: GPL-3.0-only

// model.ts — состояние экрана «Соединения» как чистый редьюсер (T-79): кадр
// потока WatchConnections → активные + история закрытых, пауза, сброс.
//
// Пауза замораживает ПОКАЗ, а не приём: поток продолжает работать, модель
// `live` обновляется (closedIds не теряются, история копится), а на экране
// остаётся снимок `frozen`. «Продолжить» просто снова показывает `live`.
import { create } from '@bufbuild/protobuf';
import { ConnectionSchema, Connection_Status } from '../../gen/lavray_pb';
import type { Connection, ConnectionSnapshot } from '../../gen/lavray_pb';
import { clearHistory, createHistory, pushHistory } from './history';
import type { ClosedHistory } from './history';

/** Сколько активных соединений просит UI у ядра (избыток ядро помечает truncated). */
export const ACTIVE_PAGE_LIMIT = 500;

/** То, что берётся из кадра потока. */
export type ConnsFrame = Pick<ConnectionSnapshot, 'active' | 'closedIds' | 'truncated'>;

export interface ConnsModel {
  /** Полный список активных из последнего кадра (новейшие первыми). */
  readonly active: readonly Connection[];
  readonly closed: ClosedHistory;
  readonly truncated: boolean;
  /** Время получения последнего кадра: «сейчас» для длительности активных. */
  readonly nowMs: number;
}

export interface ConnsState {
  readonly live: ConnsModel;
  /** Снимок на паузе; `null` — не на паузе. */
  readonly frozen: ConnsModel | null;
}

export type ConnsAction =
  | { readonly type: 'frame'; readonly frame: ConnsFrame; readonly nowMs: number }
  | { readonly type: 'pause'; readonly paused: boolean }
  | { readonly type: 'reset' };

export function createModel(): ConnsModel {
  return { active: [], closed: createHistory(), truncated: false, nowMs: 0 };
}

export function createState(): ConnsState {
  return { live: createModel(), frozen: null };
}

/** Последняя известная копия закрытого соединения: CLOSED (BLOCKED остаётся BLOCKED) и время закрытия. */
function markClosed(c: Connection, nowMs: number): Connection {
  return create(ConnectionSchema, {
    ...c,
    status: c.status === Connection_Status.BLOCKED ? c.status : Connection_Status.CLOSED,
    endedAtMs: c.endedAtMs ?? BigInt(nowMs),
  });
}

/**
 * Какие из прежних активных ушли в историю: названные в closedIds и — если
 * список полный (не truncated) — исчезнувшие без closedIds (так бывает после
 * переподключения потока: ядро считает closedIds от прошлого кадра ЭТОГО потока).
 * Соединение, которого мы не видели в прошлом кадре, показать нечем и в историю не идёт.
 */
function closedSince(model: ConnsModel, frame: ConnsFrame): Connection[] {
  const stillActive = new Set(frame.active.map((c) => c.id));
  const named = new Set(frame.closedIds);
  return model.active.filter(
    (c) => !stillActive.has(c.id) && (named.has(c.id) || !frame.truncated),
  );
}

export function applyFrame(model: ConnsModel, frame: ConnsFrame, nowMs: number): ConnsModel {
  const moved = closedSince(model, frame).map((c) => markClosed(c, nowMs));
  return {
    active: frame.active,
    closed: pushHistory(model.closed, moved),
    truncated: frame.truncated,
    nowMs,
  };
}

function resetModel(model: ConnsModel): ConnsModel {
  return { ...createModel(), closed: clearHistory(model.closed) };
}

export function connsReducer(state: ConnsState, action: ConnsAction): ConnsState {
  switch (action.type) {
    case 'frame':
      return { ...state, live: applyFrame(state.live, action.frame, action.nowMs) };
    case 'pause':
      if (action.paused) return state.frozen === null ? { ...state, frozen: state.live } : state;
      return state.frozen === null ? state : { ...state, frozen: null };
    case 'reset':
      return { live: resetModel(state.live), frozen: null };
  }
}

/** Что показывать: на паузе — снимок, иначе живая модель. */
export function viewOf(state: ConnsState): ConnsModel {
  return state.frozen ?? state.live;
}
