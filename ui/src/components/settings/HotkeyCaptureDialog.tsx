// SPDX-License-Identifier: GPL-3.0-only

// HotkeyCaptureDialog.tsx — захват глобального сочетания (T-82). Пользователь
// нажимает сочетание в поле захвата; «Сохранить» отдаёт его оболочке, она
// проверяет правила и регистрирует. Ошибка (мало модификаторов, занято другой
// программой) показывается в диалоге, сочетание не сохраняется. Пока диалог
// открыт, нажатие прежнего сочетания не подключает и не отключает.
import { useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { accelFromKeyEvent, hotkeyErrorKey, setGlobalHotkey, suspendGlobalHotkey } from '../../lib/globalHotkey';
import { DialogShell } from '../dialogs';

export interface HotkeyCaptureDialogProps {
  /** Сочетание сохранено: нормальная запись от оболочки. */
  readonly onSaved: (accel: string) => void;
  readonly onClose: () => void;
}

export function HotkeyCaptureDialog({ onSaved, onClose }: HotkeyCaptureDialogProps): JSX.Element {
  const { t } = useI18n();
  const [combo, setCombo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    suspendGlobalHotkey(true);
    return (): void => {
      suspendGlobalHotkey(false);
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Esc закрывает диалог, Tab переводит фокус — их не перехватываем.
    if (e.key === 'Escape' || e.key === 'Tab') return;
    e.preventDefault();
    e.stopPropagation();
    const next = accelFromKeyEvent(e);
    if (next !== null) {
      setCombo(next);
      setError(null);
    }
  };

  const save = async (): Promise<void> => {
    if (combo === null) return;
    setBusy(true);
    try {
      const saved = await setGlobalHotkey(combo);
      if (saved !== null) onSaved(saved);
    } catch (e) {
      setError(t(hotkeyErrorKey(e instanceof Error ? e.message : '')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      titleId="hkCaptureTitle"
      title={t('hk.capture.title')}
      size="sm"
      onClose={onClose}
      autofocusRef={areaRef}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <span className="flex1" />
          <button
            className="btn btn-pri"
            disabled={combo === null || busy}
            onClick={() => {
              void save();
            }}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <p className="hint">{t('hk.capture.hint')}</p>
      <div
        ref={areaRef}
        className="input"
        tabIndex={0}
        role="textbox"
        aria-label={t('hk.capture.area')}
        aria-describedby={error === null ? undefined : 'hkCaptureErr'}
        onKeyDown={onKeyDown}
      >
        <kbd className="kbd">{combo ?? '…'}</kbd>
      </div>
      {error !== null && (
        <div className="set-d" id="hkCaptureErr" role="alert">
          {error}
        </div>
      )}
    </DialogShell>
  );
}
