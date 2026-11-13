// SPDX-License-Identifier: GPL-3.0-only

// TunAdminNotice.tsx — предупреждение «Для TUN запустите LAVRay от имени
// администратора» на экране «Подключение» (T-46) с кнопкой перезапуска от
// администратора (T-81). На Linux — «ядру нужно разрешение управлять сетью» с
// кнопкой выдачи (или подсказкой, как выдать вручную). Разметка баннера — как в
// ImportDialog (banner banner-warn).
import type { JSX } from 'react';
import { useI18n } from '../hooks/useI18n';
import { usePlatformText } from '../hooks/useShellCaps';
import type { TunAccessInfo } from '../lib/tunAccess';
import { Icon } from './Icon';

interface Props {
  readonly onRestart: () => void;
  /** Состояние доступа ядра (Linux); `null` — Windows и веб. */
  readonly access?: TunAccessInfo | null;
}

export function TunAdminNotice({ onRestart, access = null }: Props): JSX.Element {
  const { t } = useI18n();
  const pt = usePlatformText();
  if (access === null) {
    return (
      <div className="banner banner-warn" role="alert">
        <span className="ic">
          <Icon name="alert" />
        </span>
        <div className="bn-t">{pt('mode.tun.needAdmin')}</div>
        <div className="bn-acts">
          <button className="btn btn-sec btn-sm" id="tunNoticeRestart" onClick={onRestart}>
            {t('tun.dlg.ok')}
          </button>
        </div>
      </div>
    );
  }
  const unavailable = access.state === 'unavailable' || access.state === 'elevate';
  const text = unavailable
    ? access.reason === 'appimage'
      ? t('tun.grant.appimage')
      : access.reason === 'nosuid'
        ? t('tun.grant.nosuid')
        : t('tun.grant.unavail')
    : pt('mode.tun.needAdmin');
  return (
    <div className="banner banner-warn" role="alert">
      <span className="ic">
        <Icon name="alert" />
      </span>
      <div className="bn-t">{text}</div>
      {!unavailable && (
        <div className="bn-acts">
          <button className="btn btn-sec btn-sm" id="tunNoticeRestart" onClick={onRestart}>
            {t(access.state === 'manual' ? 'tun.grant.how' : 'tun.grant.ok')}
          </button>
        </div>
      )}
    </div>
  );
}
