// SPDX-License-Identifier: GPL-3.0-only

// WebGate.tsx — ворота веб-панели: до входа вместо приложения показываются
// экраны входа и первичной настройки. В оболочке, в dev-режиме с подменой адреса
// ядра и на ядре без веб-панели (UNIMPLEMENTED) приложение открывается сразу.
import { useMemo } from 'react';
import type { JSX, ReactNode } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { useWebSession } from '../../hooks/useWebSession';
import { coreUrlFromEnv, createCoreClients } from '../../lib/core';
import { getCsrfToken, isWebShell } from '../../lib/webSession';
import { FirstAdminScreen } from './FirstAdminScreen';
import { InsecureBanner } from './InsecureBanner';
import { LoginScreen } from './LoginScreen';
import { WebSessionContext } from './WebSessionContext';

export function WebGate({ children }: { readonly children: ReactNode }): JSX.Element {
  // Решение принимается один раз на загрузку страницы: окно не превращается из
  // оболочки в браузер на лету.
  const active = useMemo(() => isWebShell(), []);
  return active ? <Gate>{children}</Gate> : <>{children}</>;
}

function Gate({ children }: { readonly children: ReactNode }): JSX.Element {
  const { t } = useI18n();
  const web = useMemo(
    () => createCoreClients(coreUrlFromEnv(), { mode: 'cookie', csrf: getCsrfToken }).web,
    [],
  );
  const s = useWebSession(web);
  const controls = useMemo(() => ({ username: s.username, logout: s.logout }), [s.username, s.logout]);

  switch (s.phase) {
    case 'loading':
      return (
        <div id="webLogin">
          <p role="status" aria-busy="true">
            {t('web.loading')}
          </p>
        </div>
      );
    case 'error':
      return (
        <div id="webLogin">
          <div className="wl-card">
            <p role="alert">{t('web.login.down')}</p>
            <button className="btn btn-pri" onClick={s.retry}>
              {t('web.retry')}
            </button>
          </div>
        </div>
      );
    case 'setup':
      return <FirstAdminScreen busy={s.busy} message={s.message} onSubmit={(u, p, c) => void s.setup(u, p, c)} />;
    case 'login':
      return (
        <LoginScreen
          busy={s.busy}
          message={s.message}
          lockedUntil={s.lockedUntil}
          onSubmit={(u, p) => void s.login(u, p)}
        />
      );
    case 'none':
      return <>{children}</>;
    case 'ready':
      return (
        <WebSessionContext.Provider value={controls}>
          <InsecureBanner />
          {children}
        </WebSessionContext.Provider>
      );
  }
}
