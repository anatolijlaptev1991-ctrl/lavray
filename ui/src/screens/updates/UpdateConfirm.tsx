// SPDX-License-Identifier: GPL-3.0-only

// UpdateConfirm.tsx — подтверждение действий «Центра обновлений» (T-75): переход
// на бету, откат, установка при активной VPN-сессии. В отличие от общего
// ConfirmDialog, фокус при открытии стоит на безопасной кнопке «Отмена»:
// случайный Enter не запускает установку и не разрывает соединение.
import { useRef } from 'react';
import type { JSX } from 'react';
import { DialogShell } from '../../components/dialogs';
import { useI18n } from '../../hooks/useI18n';

interface Props {
  readonly titleId: string;
  readonly title: string;
  readonly text: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function UpdateConfirm({ titleId, title, text, confirmLabel, onConfirm, onCancel }: Props): JSX.Element {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  return (
    <DialogShell
      titleId={titleId}
      title={title}
      size="sm"
      onClose={onCancel}
      autofocusRef={cancelRef}
      footer={
        <>
          <button className="btn btn-ghost" ref={cancelRef} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <span className="flex1" />
          <button className="btn btn-pri" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ fontSize: '.8125rem' }}>{text}</p>
    </DialogShell>
  );
}
