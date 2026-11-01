// SPDX-License-Identifier: GPL-3.0-only

// RestoreDone.tsx — итог восстановления (T-83): данные заменены. Окно нельзя
// закрыть «мимо»: состояние приложения устарело, поэтому и кнопка, и Esc ведут
// к перезагрузке.
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { DialogShell } from '../dialogs';

interface Props {
  /** Часть настроек вступит в силу только после перезапуска приложения. */
  readonly needsRestart: boolean;
  readonly onReload: () => void;
}

export function RestoreDone({ needsRestart, onReload }: Props): JSX.Element {
  const { t } = useI18n();
  return (
    <DialogShell
      titleId="bkRestTitle"
      title={t('bk.restoreTitle')}
      dismissOnBackdrop={false}
      onClose={onReload}
      footer={
        <>
          <span className="flex1" />
          <button className="btn btn-pri" autoFocus onClick={onReload}>
            {t('bk.reload')}
          </button>
        </>
      }
    >
      <p role="status">{t('bk.done')}</p>
      {needsRestart && <p className="cap">{t('bk.doneRestart')}</p>}
    </DialogShell>
  );
}
