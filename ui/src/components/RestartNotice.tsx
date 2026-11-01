// SPDX-License-Identifier: GPL-3.0-only

// RestartNotice.tsx — баннер «Перезапустить ядро» для любого ответа ядра с
// `needs_profile_restart`. Один на приложение (AppNotices): разметка та же,
// что у RestartBanner. Баннер гаснет только после успешного RestartProfile;
// отказ ядра (конфиг не собрался, соединения нет) показывается под ним.
import { useState, useSyncExternalStore } from 'react';
import type { JSX } from 'react';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { showCoreError } from '../lib/core';
import { clearRestartNeeded, getRestartNeeded, subscribeRestartNeeded } from '../lib/restartNeeded';
import { Icon } from './Icon';
import { RestartBanner } from './RestartBanner';

export function RestartNotice(): JSX.Element | null {
  const { t } = useI18n();
  const core = useCore();
  const needed = useSyncExternalStore(subscribeRestartNeeded, getRestartNeeded, getRestartNeeded);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!needed) return null;

  const restart = async (): Promise<void> => {
    setErr('');
    setBusy(true);
    try {
      await core.core.restartProfile({});
      clearRestartNeeded();
    } catch (e) {
      setErr(showCoreError(e, t));
    } finally {
      setBusy(false);
    }
  };
  const later = (): void => {
    setErr('');
    clearRestartNeeded();
  };
  return (
    <>
      <RestartBanner busy={busy} onRestart={() => void restart()} onLater={later} />
      {err !== '' && (
        <div className="banner banner-err" role="alert">
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="bn-t">{err}</div>
        </div>
      )}
    </>
  );
}
