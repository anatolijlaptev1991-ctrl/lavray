// SPDX-License-Identifier: GPL-3.0-only

// TunAdminNotice.tsx — предупреждение «Для TUN запустите LAVRay от имени
// администратора» на экране «Подключение» (T-46) с кнопкой перезапуска от
// администратора (T-81). Разметка баннера — как в ImportDialog (banner
// banner-warn).
import type { JSX } from 'react';
import { useI18n } from '../hooks/useI18n';
import { Icon } from './Icon';

export function TunAdminNotice({ onRestart }: { readonly onRestart: () => void }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="banner banner-warn" role="alert">
      <span className="ic">
        <Icon name="alert" />
      </span>
      <div className="bn-t">{t('mode.tun.needAdmin')}</div>
      <div className="bn-acts">
        <button className="btn btn-sec btn-sm" id="tunNoticeRestart" onClick={onRestart}>
          {t('tun.dlg.ok')}
        </button>
      </div>
    </div>
  );
}
