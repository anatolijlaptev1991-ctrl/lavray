// SPDX-License-Identifier: GPL-3.0-only

// GroupTrafficSummary.tsx — накопленный трафик группы серверов (GetTrafficSummary):
// «↑ отправлено · ↓ получено · сессий». Над списком серверов выбранной группы;
// для «Все» — по всем группам. Нет данных (ещё не было сессий) или ядро не ответило —
// строки нет: сводка вспомогательная, ошибку она не показывает.
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { formatBytes } from '../lib/i18n';
import { totalTraffic } from '../lib/trafficSummary';
import type { TrafficTotal } from '../lib/trafficSummary';

export function GroupTrafficSummary({ groupId }: { readonly groupId: bigint | null }): JSX.Element | null {
  const { t, tf, lang } = useI18n();
  const core = useCore();
  const [total, setTotal] = useState<TrafficTotal | null>(null);
  useEffect(() => {
    const guard = { live: true };
    setTotal(null);
    void (async (): Promise<void> => {
      try {
        const res = await core.stats.getTrafficSummary(groupId === null ? {} : { groupId });
        if (guard.live) setTotal(totalTraffic(res.groups));
      } catch {
        /* нет данных — строки нет */
      }
    })();
    return (): void => {
      guard.live = false;
    };
  }, [core, groupId]);
  if (total === null || total.sessions === 0n) return null;
  return (
    <p className="cap mono" id="grpTraffic" aria-label={t('trs.label')}>
      {t('trs.label')}: ↑ {formatBytes(Number(total.up), lang)} · ↓ {formatBytes(Number(total.down), lang)} ·{' '}
      {tf('trs.sessions', { n: Number(total.sessions) })}
    </p>
  );
}
