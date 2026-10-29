// TunAdminNotice.tsx — предупреждение «Для TUN запустите LAVRay от имени
// администратора» на экране «Подключение» (T-46). Разметка баннера — как в
// ImportDialog (banner banner-warn).
import type { JSX } from 'react';
import { useI18n } from '../hooks/useI18n';
import { Icon } from './Icon';

export function TunAdminNotice(): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="banner banner-warn" role="alert">
      <span className="ic">
        <Icon name="alert" />
      </span>
      <div className="bn-t">{t('mode.tun.needAdmin')}</div>
    </div>
  );
}
