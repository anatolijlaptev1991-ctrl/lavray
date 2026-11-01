// SPDX-License-Identifier: GPL-3.0-only

// LastCheckedLine.tsx — «Последняя проверка: N дней назад» (T-75, UPDATE-SYSTEM
// §5.7). До первой успешной проверки строки нет вовсе; с 7-х суток добавляется
// предупреждение, с 30-х — красная пометка (цвет не единственный признак: рядом
// текст).
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { freshnessOf } from '../../lib/updates/freshness';

interface Props {
  /** Время последней успешной проверки (мс), 0 — проверок не было. */
  readonly lastCheckedAtMs: number;
  /** Текущее время; для тестов. */
  readonly nowMs?: number;
}

export function LastCheckedLine({ lastCheckedAtMs, nowMs = Date.now() }: Props): JSX.Element | null {
  const { t, tf, plural } = useI18n();
  const f = freshnessOf(lastCheckedAtMs, nowMs);
  if (f.kind === 'never') return null;
  const when = f.days === 0 ? t('upd.today') : plural('pl.updDays', f.days);
  return (
    <span className="cap upd-last" data-fresh={f.kind} id="updLastCheck">
      {tf('upd.lastCheck', { when })}
      {f.kind === 'warn' && (
        <span className="badge badge-warn" style={{ marginInlineStart: 8 }}>
          {t('upd.stale.warn')}
        </span>
      )}
      {f.kind === 'red' && (
        <span className="badge badge-err" style={{ marginInlineStart: 8 }}>
          {t('upd.stale.red')}
        </span>
      )}
    </span>
  );
}
