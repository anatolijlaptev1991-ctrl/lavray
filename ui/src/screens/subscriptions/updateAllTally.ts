// SPDX-License-Identifier: GPL-3.0-only

// updateAllTally.ts — итог «Обновить все» по кадрам прогресса UpdateAllSubscriptions.
import { SubscriptionProgress_Phase } from '../../gen/lavray_pb';

/** Итог прогона по кадрам стрима. */
export interface UpdateAllTally {
  readonly ok: number;
  readonly skip: number;
  readonly fail: number;
  /** Подписки, ждущие подтверждения удаления серверов. */
  readonly confirm: number;
}

/** Считает итоговые кадры по подпискам: по одному на подписку (DONE/FAILED/SKIPPED/CONFIRM_REQUIRED). */
export function tallyPhase(tally: UpdateAllTally, phase: SubscriptionProgress_Phase): UpdateAllTally {
  switch (phase) {
    case SubscriptionProgress_Phase.DONE:
      return { ...tally, ok: tally.ok + 1 };
    case SubscriptionProgress_Phase.SKIPPED:
      return { ...tally, skip: tally.skip + 1 };
    case SubscriptionProgress_Phase.FAILED:
      return { ...tally, fail: tally.fail + 1 };
    case SubscriptionProgress_Phase.CONFIRM_REQUIRED:
      return { ...tally, confirm: tally.confirm + 1 };
    default:
      return tally;
  }
}
