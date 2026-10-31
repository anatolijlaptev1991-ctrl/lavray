// SPDX-License-Identifier: GPL-3.0-only

// traffic.ts — кадр StatsService.Subscribe → скорость и итоги сессии (T-79).
// Чистые функции: статус-бар, график и тесты считают одинаково.
import type { StatsSnapshot } from '../gen/lavray_pb';

export interface Speed {
  readonly down: number;
  readonly up: number;
}

export interface TrafficTotals {
  readonly down: number;
  readonly up: number;
}

export interface TrafficReading {
  readonly speed: Speed;
  /** Итоги сессии: приходят в кадрах со `session`, в том числе в финальном. */
  readonly totals: TrafficTotals;
}

export const ZERO_SPEED: Speed = { down: 0, up: 0 };

/** До первого кадра показывать нечего: нули, а не прежняя сессия и не выброс. */
export const EMPTY_READING: TrafficReading = { speed: ZERO_SPEED, totals: ZERO_SPEED };

/** Сумма по ВСЕМ тегам, включая `other` (трафик, который трекер не смог отнести к исходящему). */
export function sumTags(tags: StatsSnapshot['tags']): Speed {
  let down = 0;
  let up = 0;
  for (const tag of tags) {
    down += tag.downlinkBps;
    up += tag.uplinkBps;
  }
  return { down, up };
}

/**
 * Применяет кадр. Обычный кадр несёт готовую скорость (первый приходит через
 * один интервал и уже настоящий) — берём её как есть. Финальный кадр (сессия
 * остановлена) обнуляет скорость; итоги из него остаются.
 */
export function applySnapshot(prev: TrafficReading, snap: StatsSnapshot): TrafficReading {
  const session = snap.session;
  const totals: TrafficTotals =
    session === undefined
      ? prev.totals
      : { down: Number(session.downlinkTotal), up: Number(session.uplinkTotal) };
  return { speed: snap.final ? ZERO_SPEED : sumTags(snap.tags), totals };
}
