// SPDX-License-Identifier: GPL-3.0-only

// BackupRows.tsx — строки «Резервная копия» в «Настройках» (T-83): создать
// зашифрованную копию всех данных и восстановить из неё. Диалоги живут в
// components/backup; здесь только кнопки и состояние «какой диалог открыт».
import { useState } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { BackupExportDialog } from '../backup/BackupExportDialog';
import { BackupRestoreDialog } from '../backup/BackupRestoreDialog';

type Open = 'export' | 'restore' | null;

interface Props {
  /** Показать сообщение об успехе («Резервная копия сохранена»). */
  readonly onOk: (text: string) => void;
  /** Перечитать состояние приложения после замены данных; по умолчанию — перезагрузка страницы. */
  readonly onRestored?: () => void;
}

const reloadPage = (): void => {
  window.location.reload();
};

export function BackupRows({ onOk, onRestored = reloadPage }: Props): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState<Open>(null);
  const close = (): void => {
    setOpen(null);
  };
  return (
    <>
      <div className="set-row">
        <div className="set-txt">
          <div className="set-l">{t('bk.export')}</div>
          <div className="set-d">{t('bk.hint')}</div>
        </div>
        <div className="set-ctl">
          <button
            className="btn btn-sec btn-sm"
            aria-label={t('bk.export')}
            onClick={() => {
              setOpen('export');
            }}
          >
            {t('bk.exportBtn')}
          </button>
        </div>
      </div>
      <div className="set-row">
        <div className="set-txt">
          <div className="set-l">{t('bk.restore')}</div>
          <div className="set-d">{t('bk.restoreD')}</div>
        </div>
        <div className="set-ctl">
          <button
            className="btn btn-ghost btn-sm"
            aria-label={t('bk.restore')}
            onClick={() => {
              setOpen('restore');
            }}
          >
            {t('bk.restore')}
          </button>
        </div>
      </div>
      {open === 'export' && (
        <BackupExportDialog
          onClose={close}
          onSaved={() => {
            close();
            onOk(t('bk.saved'));
          }}
        />
      )}
      {open === 'restore' && <BackupRestoreDialog onClose={close} onRestored={onRestored} />}
    </>
  );
}
