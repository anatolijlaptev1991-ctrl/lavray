// SPDX-License-Identifier: GPL-3.0-only

// InsecureBanner.tsx — «Не защищено»: панель открыта по HTTP не на loopback, пароль
// и cookie идут открытым текстом (OPENWRT-GATEWAY §6, ключи web.insecure*).
import type { JSX } from 'react';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../hooks/useI18n';
import { isInsecureTransport } from '../../lib/webSession';

export interface InsecureBannerProps {
  /** Адрес страницы; по умолчанию window.location (подмена — для тестов). */
  readonly location?: Pick<Location, 'protocol' | 'hostname'>;
  /** card — внутри карточки входа; bar — полоса над приложением. */
  readonly variant?: 'bar' | 'card';
}

export function InsecureBanner({ location, variant = 'bar' }: InsecureBannerProps): JSX.Element | null {
  const { t } = useI18n();
  if (!isInsecureTransport(location)) return null;
  return (
    <div
      className={`banner banner-warn${variant === 'bar' ? ' web-insecure' : ''}`}
      role="status"
      data-testid="insecure-banner"
    >
      <span className="ic">
        <Icon name="alert" />
      </span>
      <div className="bn-t">
        <strong>{t('web.insecure')}.</strong> {t('web.insecure.long')}
      </div>
    </div>
  );
}
