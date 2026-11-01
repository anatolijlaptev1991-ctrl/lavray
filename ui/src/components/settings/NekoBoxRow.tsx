// SPDX-License-Identifier: GPL-3.0-only

// NekoBoxRow.tsx — строка «Перенос из NekoBox» в «Настройках» (T-78): кнопка
// открывает тот же диалог, что и плитка онбординга. Диалог живёт в
// components/nekobox; здесь только строка и состояние «открыт ли диалог».
import { useState } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { NekoBoxImportDialog } from '../nekobox/NekoBoxImportDialog';

interface Props {
  /** Перенос выполнен: экран настроек перечитывает значения. */
  readonly onImported?: () => void;
}

export function NekoBoxRow({ onImported }: Props): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="set-row">
        <div className="set-txt">
          <div className="set-l">{t('nb.row.l')}</div>
          <div className="set-d">{t('nb.row.d')}</div>
        </div>
        <div className="set-ctl">
          <button
            className="btn btn-sec btn-sm"
            aria-label={t('nb.row.l')}
            onClick={() => {
              setOpen(true);
            }}
          >
            {t('nb.row.btn')}
          </button>
        </div>
      </div>
      {open && (
        <NekoBoxImportDialog
          {...(onImported === undefined ? {} : { onImported })}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
