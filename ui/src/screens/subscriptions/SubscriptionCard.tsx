// SPDX-License-Identifier: GPL-3.0-only

// SubscriptionCard.tsx — карточка подписки на экране «Подписки» (прототип .sub-card):
// имя и ошибка, URL, число серверов, сроки, трафик с прогрессом, автообновление,
// обновление, откат и удаление. Вынесено из screen_subscriptions.tsx (трещотка);
// действия выполняет экран.
import type { JSX } from 'react';
import type { Group } from '../../gen/lavray_pb';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../hooks/useI18n';
import { NB, formatBytes } from '../../lib/i18n';
import { RollbackAction } from './RollbackAction';
import { nextUpdateMs, relDate } from './subscriptionTime';

export type SubErrKey =
  | 'sub.err.auth'
  | 'sub.err.notFound'
  | 'sub.err.timeout'
  | 'sub.err.zero'
  | 'sub.err.generic';

/** Последняя ошибка обновления: ключ фразы и короткий код (HTTP-статус, timeout, zero). */
export interface SubError {
  readonly key: SubErrKey;
  readonly code: string;
}

export interface SubscriptionCardProps {
  readonly group: Group;
  /** Серверов в группе. */
  readonly count: number;
  /** Последняя ошибка обновления; null — ошибок нет. */
  readonly error: SubError | null;
  readonly busy: boolean;
  readonly onSettings: () => void;
  readonly onOpenUrl: () => void;
  readonly onToggleAuto: () => void;
  readonly onUpdate: () => void;
  readonly onDelete: () => void;
  /** Откат удался: текст итога; экран перечитывает список. */
  readonly onRolledBack: (text: string) => void;
}

export function SubscriptionCard({
  group: g,
  count,
  error: lastErr,
  busy: isBusy,
  onSettings,
  onOpenUrl,
  onToggleAuto,
  onUpdate,
  onDelete,
  onRolledBack,
}: SubscriptionCardProps): JSX.Element {
  const { t, tf, lang } = useI18n();
  const info = g.subscriptionInfo;
  const used = Number(info?.uploadBytes ?? 0n) + Number(info?.downloadBytes ?? 0n);
  const limit = Number(info?.totalBytes ?? 0n);
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const expire = info?.expireMs !== undefined ? Number(info.expireMs) : 0;
  const soon = expire > 0 && expire - Date.now() < 3 * 864e5;
  const nextAt = nextUpdateMs(g);
  return (
    <article className="card sub-card">
      <div className="sub-top">
        <h3 title={g.name}>{g.name}</h3>
        {lastErr !== null && (
          <span className="badge badge-err">
            <span className="dot err" />
            {t('sub.err.badge')}
          </span>
        )}
        <span className="flex1" />
        <button
          className="btn btn-ic btn-sm"
          aria-label={t('sub.settings')}
          title={t('sub.settings')}
          onClick={onSettings}
        >
          <Icon name="settings" />
        </button>
        <button
          className="btn btn-ic btn-sm"
          aria-label={t('common.open')}
          title={t('common.open')}
          onClick={onOpenUrl}
        >
          <Icon name="external" />
        </button>
      </div>

      <div className="sub-url" title={g.subscriptionUrl ?? ''}>
        {g.subscriptionUrl ?? ''}
      </div>

      <div className="sub-meta">
        <div className="row">
          <span className="k">{t('nav.servers')}</span>
          <span>{String(count)}</span>
        </div>
        <div className="row">
          <span className="k">{t('subs.lastUp')}</span>
          <span>
            {g.lastUpdateMs !== undefined ? relDate(Number(g.lastUpdateMs), lang) : '—'}
          </span>
        </div>
        {lastErr === null && (
          <div className="row">
            <span className="k">{t('subs.next')}</span>
            <span>{nextAt === null ? '—' : relDate(Math.max(nextAt, Date.now()), lang)}</span>
          </div>
        )}
        <div className="row">
          <span className="k">{t('subs.expiry')}</span>
          <span>
            {expire > 0 ? (
              <>
                {tf('sub.expires', { when: relDate(expire, lang) })}
                {soon && (
                  <span className="badge badge-warn" style={{ marginInlineStart: 6 }}>
                    {t('sub.expiresSoon')}
                  </span>
                )}
              </>
            ) : (
              t('sub.noExpiry')
            )}
          </span>
        </div>
      </div>

      {lastErr !== null && (
        <div className="sub-errline">
          <Icon name="alert" />
          <span>
            {t(lastErr.key)}
            {lastErr.code !== 'error' && (
              <>
                {' '}
                <span className="cap mono">({lastErr.code})</span>
              </>
            )}
          </span>
        </div>
      )}

      <div className="sub-traffic">
        <div className="row">
          <span className="k">{t('subs.traffic')}</span>
          <b>
            ↓ {formatBytes(Number(info?.downloadBytes ?? 0n), lang)} · ↑{' '}
            {formatBytes(Number(info?.uploadBytes ?? 0n), lang)}
          </b>
        </div>
        <div className="progress">
          <div style={{ width: `${String(pct)}%` }} />
        </div>
        <span className="cap">
          {limit > 0
            ? `${formatBytes(used, lang)}${NB}${t('subs.of')}${NB}${formatBytes(limit, lang)}`
            : t('sub.unlimited')}
        </span>
      </div>

      <div className="sub-foot">
        <div className="sub-auto">
          <span>{t('subs.auto')}</span>
          <button
            className={`sw${g.skipAutoUpdate ? '' : ' on'}`}
            role="switch"
            aria-checked={!g.skipAutoUpdate}
            aria-label={t('subs.auto')}
            onClick={onToggleAuto}
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className={`btn btn-sec btn-sm${isBusy ? ' loading' : ''}`}
            aria-label={t('common.refresh')}
            title={t('common.refresh')}
            disabled={isBusy}
            onClick={onUpdate}
          >
            <Icon name="refresh" />
          </button>
          <RollbackAction group={g} onDone={onRolledBack} />
          <button
            className="btn btn-ghost btn-sm"
            aria-label={t('subs.delete')}
            title={t('subs.delete')}
            onClick={onDelete}
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>
    </article>
  );
}
