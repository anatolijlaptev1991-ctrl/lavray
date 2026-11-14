// SPDX-License-Identifier: GPL-3.0-only

// ProxyErrorBanner.tsx — баннер «Не удалось включить системный прокси: <причина>.
// Включите режим TUN» на экране «Подключение». Появляется, когда окно само
// (после автозапуска или подключения извне) не смогло поставить прокси ОС.
import { useSyncExternalStore } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../hooks/useI18n';
import { useShellCaps } from '../hooks/useShellCaps';
import { clearProxyError, getProxyError, subscribeProxyError } from '../lib/proxyError';
import { Icon } from './Icon';

/** Совет про TUN — там, где TUN не требует администратора (Linux), и пока режим TUN ещё не выбран. */
export function ProxyErrorBanner({ tunMode }: { readonly tunMode: boolean }): JSX.Element | null {
  const { t, tf } = useI18n();
  const linux = useShellCaps().os === 'linux';
  const advice = !tunMode && linux;
  const reason = useSyncExternalStore(subscribeProxyError, getProxyError, getProxyError);
  if (reason === null) return null;
  return (
    <div className="banner banner-warn" id="proxyBanner" role="alert" style={{ gridColumn: '1 / -1', marginBottom: 0 }}>
      <span className="ic">
        <Icon name="alert" />
      </span>
      <div className="bn-t">{tf('err.sysproxy', { reason })}
        {advice && ` ${t('err.sysproxy.tun')}`}</div>
      <div className="bn-acts">
        <button className="btn btn-ghost btn-sm" id="proxyBannerClose" onClick={clearProxyError}>
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
