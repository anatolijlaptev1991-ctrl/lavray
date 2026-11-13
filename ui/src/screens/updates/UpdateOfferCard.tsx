// SPDX-License-Identifier: GPL-3.0-only

// UpdateOfferCard.tsx — карточка найденного обновления (T-75): версия и метка,
// заметки (только текст) и главное действие по состоянию — «Скачать», прогресс с
// «Отменить», «Установить сейчас». Установка при активной VPN-сессии сначала
// спрашивает подтверждение. Ошибка и установка рисуются отдельно (StatusNotices).
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import type { UpdateFlowApi } from '../../hooks/useUpdateFlow';
import { usePackageUpdates } from '../../hooks/useShellCaps';
import type { FlowState } from '../../lib/updates/types';
import { DownloadProgress } from './DownloadProgress';
import { PackageUpdateNote } from './PackageUpdateNote';
import { ReleaseNotes } from './ReleaseNotes';
import { UpdateBadge } from './UpdateBadge';
import { UpdateConfirm } from './UpdateConfirm';

type Offer = Extract<FlowState, { kind: 'available' | 'downloading' | 'ready' }>;

function Actions({ state, flow }: { readonly state: Offer; readonly flow: UpdateFlowApi }): JSX.Element {
  const { t } = useI18n();
  if (state.kind === 'downloading') {
    return (
      <button className="btn btn-ghost" onClick={flow.cancelDownload}>
        {t('upd.cancelDownload')}
      </button>
    );
  }
  if (state.kind === 'ready') {
    return (
      <button className="btn btn-pri" onClick={flow.install}>
        {t('upd.installNow')}
      </button>
    );
  }
  return (
    <button className="btn btn-pri" onClick={flow.download}>
      {t('upd.download')}
    </button>
  );
}

export function UpdateOfferCard({ state, flow }: { readonly state: Offer; readonly flow: UpdateFlowApi }): JSX.Element {
  const { t, tf } = useI18n();
  const { update } = state;
  // Linux: ни скачивать, ни ставить из приложения нечего — только пакет.
  const byPackage = usePackageUpdates();
  return (
    <div className="upd-card" aria-labelledby="updOfferTitle" role="group">
      <div className="upd-row" style={{ border: 0, background: 'none', padding: 0 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 id="updOfferTitle">
            <span className="mono">{update.version}</span> —{' '}
            <span style={{ fontWeight: 500 }}>{t('upd.available')}</span>{' '}
            <UpdateBadge update={update} />
          </h3>
          <p className="cap" style={{ marginTop: 4 }}>
            {update.currentVersion} → {update.version}
          </p>
          {state.kind === 'ready' && <p style={{ marginTop: 8, fontSize: '.8125rem' }}>{tf('upd.ready', { v: update.version })}</p>}
          {state.kind === 'ready' && state.notice === 'uacCancelled' && (
            <p role="status" className="cap" style={{ marginTop: 8 }}>
              {t('upd.uacCancelled')}
            </p>
          )}
          <ReleaseNotes notes={update.notes} />
        </div>
        {byPackage ? <PackageUpdateNote version={update.version} /> : <Actions state={state} flow={flow} />}
      </div>
      {!byPackage && state.kind === 'downloading' && (
        <DownloadProgress downloaded={state.downloaded} total={state.total} bps={state.bps} />
      )}
      {state.kind === 'ready' && state.askSession && (
        <UpdateConfirm
          titleId="updSessionTitle"
          title={t('upd.sessionT')}
          text={t('upd.sessionD')}
          confirmLabel={t('upd.sessionOk')}
          onConfirm={flow.confirmSession}
          onCancel={flow.declineSession}
        />
      )}
    </div>
  );
}
