// SPDX-License-Identifier: GPL-3.0-only

// RestartBanner.tsx — «изменение применится после перезапуска ядра» с кнопками
// «Перезапустить ядро» и «Позже» (разметка .restart-banner экрана DNS).
import type { JSX } from 'react';
import { useI18n } from '../hooks/useI18n';
import { Icon } from './Icon';

export interface RestartBannerProps {
  readonly busy: boolean;
  readonly onRestart: () => void;
  readonly onLater: () => void;
}

export function RestartBanner({ busy, onRestart, onLater }: RestartBannerProps): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="restart-banner" role="status">
      <span className="ic">
        <Icon name="alert" />
      </span>
      <span className="t">{t('dns.restart')}</span>
      <button className="btn btn-sec btn-sm" disabled={busy} aria-busy={busy} onClick={onRestart}>
        <Icon name="refresh" />
        <span>{t('dns.restartBtn')}</span>
      </button>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onLater}>
        {t('dns.restartLater')}
      </button>
    </div>
  );
}
