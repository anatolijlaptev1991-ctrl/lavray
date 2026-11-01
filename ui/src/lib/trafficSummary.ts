// SPDX-License-Identifier: GPL-3.0-only

// trafficSummary.ts — сумма сводок трафика по группам (GetTrafficSummary).
import type { GroupTrafficSummary } from '../gen/lavray_pb';

export interface TrafficTotal {
  readonly up: bigint;
  readonly down: bigint;
  readonly sessions: bigint;
}

/** Сумма сводок (для «Все группы»). */
export function totalTraffic(groups: readonly GroupTrafficSummary[]): TrafficTotal {
  return groups.reduce<TrafficTotal>(
    (acc, g) => ({
      up: acc.up + g.uplinkBytes,
      down: acc.down + g.downlinkBytes,
      sessions: acc.sessions + g.sessionCount,
    }),
    { up: 0n, down: 0n, sessions: 0n },
  );
}
