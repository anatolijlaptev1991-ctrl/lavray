// SPDX-License-Identifier: GPL-3.0-only

// RollbackRow.tsx — «Откатиться на <версию>» (T-75). Показывается только когда
// GetUpdateState сообщил rollback_available (оболочка хранит прошлый установщик).
// Откат перезапускает приложение, поэтому — с подтверждением.
import { useState } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { useRollback } from '../../hooks/useRollback';
import type { RollbackState } from '../../hooks/useRollback';
import { UpdateConfirm } from './UpdateConfirm';

function RollbackStatus({ state }: { readonly state: RollbackState }): JSX.Element | null {
  const { t } = useI18n();
  switch (state.kind) {
    case 'working':
      return (
        <div className="set-d" role="status" aria-busy="true">
          {t('upd.stage.install')}
        </div>
      );
    case 'installing':
      return (
        <div className="set-d" role="status" aria-busy="true">
          {t('upd.installing')}
        </div>
      );
    case 'cancelled':
      return (
        <div className="set-d" role="status">
          {t('upd.uacCancelled')}
        </div>
      );
    case 'error':
      return (
        <div className="set-d" role="alert">
          {t(state.key)}
        </div>
      );
    case 'idle':
      return null;
  }
}

export function RollbackRow({ version }: { readonly version: string }): JSX.Element {
  const { tf } = useI18n();
  const { state, run } = useRollback();
  const [asking, setAsking] = useState(false);
  const v = version === '' ? '—' : version;
  const label = tf('upd.rollback', { v });
  return (
    <div className="set-row" id="updRollbackRow">
      <div className="set-txt">
        <div className="set-l">{label}</div>
        <RollbackStatus state={state} />
      </div>
      <div className="set-ctl">
        <button
          className="btn btn-ghost btn-sm"
          disabled={state.kind === 'working' || state.kind === 'installing'}
          onClick={() => {
            setAsking(true);
          }}
        >
          {label}
        </button>
      </div>
      {asking && (
        <UpdateConfirm
          titleId="updRollbackTitle"
          title={tf('upd.rbTitle', { v })}
          text={tf('upd.rbConfirm', { v })}
          confirmLabel={label}
          onConfirm={() => {
            setAsking(false);
            run();
          }}
          onCancel={() => {
            setAsking(false);
          }}
        />
      )}
    </div>
  );
}
