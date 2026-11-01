// SPDX-License-Identifier: GPL-3.0-only

// DataComponentRow.tsx — строка компонента-данных на экране «Обновления»
// (T-75/7.5): название, «было → стало» или «актуально», ход и итог действия,
// кнопки «Обновить» и «Откатить». Состояние читается скринридером (role=status /
// role=alert); пока идёт любое действие, кнопки недоступны.
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import type { DataRow, DataStep } from '../../hooks/useUpdateData';
import type { MessageKey } from '../../lib/i18n';
import type { DataKind } from '../../lib/updates/dataComponents';

const NAME: Readonly<Record<DataKind, MessageKey>> = { presets: 'upd.comp.presets', geo: 'upd.comp.geo' };

interface Props {
  readonly row: DataRow;
  readonly checked: boolean;
  readonly busy: boolean;
  readonly onInstall: () => void;
  readonly onRollback: () => void;
}

function Versions({ row, checked }: { readonly row: DataRow; readonly checked: boolean }): JSX.Element {
  const { t, tf } = useI18n();
  if (row.offer !== null) {
    const from = row.offer.current === '' ? t('upd.comp.bundled') : row.offer.current;
    return <span className="mono">{tf('upd.comp.versions', { from, to: row.offer.available })}</span>;
  }
  return <span>{t(checked ? 'upd.comp.upToDate' : 'upd.comp.notChecked')}</span>;
}

function Previous({ previous }: { readonly previous: string }): JSX.Element {
  const { t, tf } = useI18n();
  return <>{previous === '' ? t('upd.comp.prevBundled') : tf('upd.comp.prev', { v: previous })}</>;
}

function Progress({ step }: { readonly step: DataStep }): JSX.Element | null {
  const { t } = useI18n();
  switch (step.kind) {
    case 'working':
      return (
        <div className="set-d" role="status" aria-busy="true">
          {t(step.what === 'install' ? 'upd.stage.download' : 'upd.comp.working.rollback')}
        </div>
      );
    case 'done':
      return (
        <div className="set-d" role="status">
          {t(step.what === 'applied' ? 'upd.comp.done.applied' : 'upd.comp.done.rolledBack')}
          {step.restart && <> {t('upd.comp.restart')}</>}
        </div>
      );
    case 'error':
      return (
        <div className="set-d" role="alert">
          {t(step.key)}
        </div>
      );
    case 'idle':
      return null;
  }
}

export function DataComponentRow({ row, checked, busy, onInstall, onRollback }: Props): JSX.Element {
  const { t } = useI18n();
  const name = t(NAME[row.kind]);
  return (
    <div className="set-row" data-kind={row.kind}>
      <div className="set-txt">
        <div className="set-l">{name}</div>
        <div className="set-d">
          <Versions row={row} checked={checked} />
        </div>
        {row.rollback !== null && (
          <div className="set-d">
            <Previous previous={row.rollback.previous} />
          </div>
        )}
        <Progress step={row.step} />
      </div>
      <div className="set-ctl" style={{ display: 'flex', gap: 8 }}>
        {row.offer !== null && (
          <button className="btn btn-pri btn-sm" disabled={busy} aria-label={`${t('upd.comp.apply')}: ${name}`} onClick={onInstall}>
            {t('upd.comp.apply')}
          </button>
        )}
        {row.rollback !== null && (
          <button className="btn btn-ghost btn-sm" disabled={busy} aria-label={`${t('upd.comp.rollback')}: ${name}`} onClick={onRollback}>
            {t('upd.comp.rollback')}
          </button>
        )}
      </div>
    </div>
  );
}
