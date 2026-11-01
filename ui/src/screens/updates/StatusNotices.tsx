// SPDX-License-Identifier: GPL-3.0-only

// StatusNotices.tsx — безымянные состояния «Центра обновлений» (T-75): идёт
// проверка, версия последняя, проверка не удалась, обновления не настроены,
// идёт установка, ошибка. Проверка, которая не удалась, никогда не рисуется как
// «обновлений нет»: у неё своя красная плашка с повтором.
import type { JSX, ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../hooks/useI18n';
import type { UpdateFlowApi } from '../../hooks/useUpdateFlow';
import type { FlowState, Versions } from '../../lib/updates/types';

export function CheckingNotice(): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="upd-card" role="status" aria-busy="true">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="ic ic-spin" style={{ color: 'var(--accent)' }}>
          <Icon name="refresh" />
        </span>
        <span>{t('upd.checking')}</span>
      </div>
    </div>
  );
}

export function UpToDateCard({ versions }: { readonly versions: Versions }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="card" role="status" style={{ borderColor: 'var(--ok)' }}>
      <div className="card-h">
        <span className="ic">
          <Icon name="check" />
        </span>
        <h2>{t('upd.upToDate')}</h2>
      </div>
      <div className="sub-meta">
        <div className="row">
          <span className="k">{t('upd.app')}</span>
          <span className="mono">{versions.app}</span>
        </div>
        <div className="row">
          <span className="k">{t('upd.core')}</span>
          <span className="mono">{versions.core}</span>
        </div>
      </div>
    </div>
  );
}

export function NotConfiguredNotice(): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="infoblock" role="status">
      <span className="ic">
        <Icon name="info" />
      </span>
      <div className="t">
        <b>{t('upd.notConfigured')}</b>
      </div>
    </div>
  );
}

export function InstallingNotice(): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="upd-card" role="status" aria-busy="true">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="ic ic-spin" style={{ color: 'var(--accent)' }}>
          <Icon name="refresh" />
        </span>
        <span>{t('upd.installing')}</span>
      </div>
    </div>
  );
}

function AlertBanner({ children, actions }: { readonly children: ReactNode; readonly actions: ReactNode }): JSX.Element {
  return (
    <div className="banner banner-err" role="alert">
      <span className="ic">
        <Icon name="alert" />
      </span>
      <div className="bn-t">{children}</div>
      <div className="bn-acts">{actions}</div>
    </div>
  );
}

/** Проверка не удалась (сеть): это НЕ «обновлений нет». */
export function CheckFailedBanner({ flow }: { readonly flow: UpdateFlowApi }): JSX.Element {
  const { t } = useI18n();
  return (
    <AlertBanner
      actions={
        <button className="btn btn-sec btn-sm" onClick={flow.check}>
          {t('upd.retry')}
        </button>
      }
    >
      {t('upd.checkFailed')}
    </AlertBanner>
  );
}

type ErrorState = Extract<FlowState, { kind: 'error' }>;

/** Ошибка шага: понятная причина, сырой текст ядра мелко и кнопка повтора нужного шага. */
export function ErrorBanner({ state, flow }: { readonly state: ErrorState; readonly flow: UpdateFlowApi }): JSX.Element {
  const { t } = useI18n();
  const retry =
    state.retry === 'check' ? flow.check : state.retry === 'download' ? flow.download : flow.install;
  return (
    <AlertBanner
      actions={
        <>
          <button className="btn btn-sec btn-sm" onClick={retry}>
            {t('upd.retry')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={flow.dismiss}>
            {t('common.close')}
          </button>
        </>
      }
    >
      {t(state.error.key)}
      {state.error.detail !== '' && <span className="cap" style={{ display: 'block' }}>{state.error.detail}</span>}
    </AlertBanner>
  );
}
