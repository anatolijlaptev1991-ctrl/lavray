// SPDX-License-Identifier: GPL-3.0-only

// PublicIpRow.tsx — «Внешний IP» через туннель в карточке «Качество связи»
// (GetPublicIp). Определяется после подключения, держится 5 минут, кнопка
// «Обновить» спрашивает заново; ошибка показывается рядом и не прячет кнопку.
import type { JSX } from 'react';
import { Icon } from '../Icon';
import { usePublicIp } from '../../hooks/usePublicIp';
import { useI18n } from '../../hooks/useI18n';

export interface PublicIpRowProps {
  readonly connected: boolean;
  /** Сеанс соединения (сервер + запуск): смена сбрасывает кэш. */
  readonly session: string;
}

export function PublicIpRow({ connected, session }: PublicIpRowProps): JSX.Element {
  const { t } = useI18n();
  const { ip, busy, error, refresh } = usePublicIp(connected, session);
  return (
    <div className="hl-cell" id="hlIp">
      <span className="cap">{t('health.ip')}</span>
      <span className="val">
        <span className="mono" aria-live="polite">
          {ip ?? '—'}
        </span>
        <button
          className="btn btn-ic btn-sm"
          aria-label={t('health.ip.refresh')}
          title={t('health.ip.refresh')}
          disabled={!connected || busy}
          aria-busy={busy}
          onClick={refresh}
        >
          <Icon name="refresh" size={16} />
        </button>
      </span>
      {error !== '' && (
        <span className="toast-err" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
