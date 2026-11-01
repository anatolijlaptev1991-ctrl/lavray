// SPDX-License-Identifier: GPL-3.0-only

// KillSwitchNotice.tsx — баннер «ядро остановилось, системный прокси сохранён»:
// приложения получают отказ, а не уходят напрямую. «Снять прокси» возвращает
// прежние настройки ОС (тот же путь, что у кнопки «Отключить»).
import { useState, useSyncExternalStore } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../hooks/useI18n';
import { applySystemProxy, isSystemProxyApplied, onSystemProxyChange } from '../lib/connection';
import { showCoreError } from '../lib/core';
import { clearProxyKept, isProxyKept, subscribeProxyKept } from '../lib/killSwitch';
import { Icon } from './Icon';

export function KillSwitchNotice(): JSX.Element | null {
  const { t } = useI18n();
  const kept = useSyncExternalStore(subscribeProxyKept, isProxyKept, isProxyKept);
  const applied = useSyncExternalStore(onSystemProxyChange, isSystemProxyApplied, isSystemProxyApplied);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!kept || !applied) return null;

  const release = async (): Promise<void> => {
    setErr('');
    setBusy(true);
    try {
      await applySystemProxy(false, 0);
      clearProxyKept();
    } catch (e) {
      setErr(showCoreError(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="banner banner-warn" role="alert">
      <span className="ic">
        <Icon name="alert" />
      </span>
      <div className="bn-t">
        <b>{t('kill.banner.t')}</b> {t('kill.banner.d')}
        {err !== '' && <div className="toast-err" role="alert">{err}</div>}
      </div>
      <button className="btn btn-sec btn-sm" disabled={busy} aria-busy={busy} onClick={() => void release()}>
        {t('kill.release')}
      </button>
    </div>
  );
}
