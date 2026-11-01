// SPDX-License-Identifier: GPL-3.0-only

// DownloadProgress.tsx — полоса и подпись загрузки обновления (T-75). Полоса —
// progressbar с доступным именем; если размер ещё неизвестен, полоса
// неопределённая (без aria-valuenow), а не «0 %».
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { formatBytes, formatSpeed } from '../../lib/i18n';

interface Props {
  readonly downloaded: number;
  readonly total: number;
  readonly bps: number;
}

/** Доля загруженного, 0…100; `null`, пока размер неизвестен. */
function percentOf(downloaded: number, total: number): number | null {
  if (!(total > 0)) return null;
  return Math.min(100, Math.max(0, Math.round((downloaded / total) * 100)));
}

export function DownloadProgress({ downloaded, total, bps }: Props): JSX.Element {
  const { t, tf, lang } = useI18n();
  const pct = percentOf(downloaded, total);
  const known = pct !== null;
  return (
    <div className="upd-stages" style={{ marginTop: 12 }}>
      <div
        className="progress"
        role="progressbar"
        aria-label={t('upd.stage.download')}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(known ? { 'aria-valuenow': pct } : {})}
      >
        <div style={{ width: known ? `${String(pct)}%` : '35%' }} />
      </div>
      <div className="upd-stage cur">
        <span className="st-ic st-dot" />
        <span>
          {t('upd.stage.download')} {known ? `${String(pct)}%` : ''}
          {known && (
            <span className="muted">
              {' · '}
              {tf('upd.dlProgress', {
                done: formatBytes(downloaded, lang),
                total: formatBytes(total, lang),
                speed: formatSpeed(bps, lang),
              })}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
