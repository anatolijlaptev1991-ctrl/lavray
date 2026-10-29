// SPDX-License-Identifier: GPL-3.0-only

// TunDialog.tsx — диалог dlgTun (T-81): режиму TUN нужны права администратора.
// Службы нет (как в NekoBox): TUN работает, когда приложение, а с ним и ядро,
// запущено от администратора. Кнопка перезапускает приложение через UAC;
// отказ в запросе системы оставляет всё как было.
import { useState } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../hooks/useI18n';
import type { RelaunchOutcome } from '../lib/elevation';
import { DialogShell } from './dialogs';

interface TunDialogProps {
  readonly onClose: () => void;
  /**
   * Запускает перезапуск от администратора. `started` — приложение сейчас
   * закроется (диалог остаётся занятым до закрытия окна), `cancelled` — в UAC
   * отказали. Ошибка (строка оболочки или `Error`) показывается в диалоге.
   */
  readonly onRelaunch: () => Promise<RelaunchOutcome>;
}

export function TunDialog({ onClose, onRelaunch }: TunDialogProps): JSX.Element {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  // Хранится причина, а не готовый текст: смена языка переводит и сообщение.
  const [notice, setNotice] = useState<
    { readonly kind: 'cancelled' } | { readonly kind: 'error'; readonly code: string } | null
  >(null);

  /** Код оболочки (`unsupported`, `admin_account_required`) — готовая фраза, прочее — текст ОС. */
  const errorText = (code: string): string => {
    if (code === 'unsupported') return t('tun.dlg.unsupported');
    if (code === 'admin_account_required') return t('tun.dlg.needAdminAccount');
    return `${t('tun.dlg.failed')}: ${code}`;
  };

  const relaunch = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await onRelaunch();
      if (outcome === 'cancelled') {
        setNotice({ kind: 'cancelled' });
        setBusy(false);
      }
      // started: окно закрывается вместе с приложением
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e);
      setNotice({ kind: 'error', code });
      setBusy(false);
    }
  };

  return (
    <DialogShell
      titleId="tunDlgTitle"
      title={t('tun.dlg.t')}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <span className="flex1" />
          <button
            className="btn btn-pri"
            id="tunRelaunch"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              void relaunch();
            }}
            autoFocus
          >
            {t('tun.dlg.ok')}
          </button>
        </>
      }
    >
      <p>{t('tun.dlg.d')}</p>
      <p className="hint">{t('tun.dlg.note')}</p>
      {notice?.kind === 'error' && (
        <div className="banner banner-err" role="alert">
          {errorText(notice.code)}
        </div>
      )}
      {notice?.kind === 'cancelled' && (
        <p className="hint" role="status">
          {t('tun.dlg.cancelled')}
        </p>
      )}
    </DialogShell>
  );
}
