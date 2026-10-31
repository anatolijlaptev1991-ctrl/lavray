// SPDX-License-Identifier: GPL-3.0-only

// QrTab.tsx — вкладка «QR-код» диалога импорта. Три способа дать картинку:
// выбрать файл, вставить из буфера обмена (Ctrl+V), снять экран (только в
// окне Tauri). Распознанная ссылка уходит в onDecoded, и диалог показывает её
// на вкладке «Ссылка» с предпросмотром; ничего не добавляется само.
import type { ChangeEvent, JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { useKbdLabel } from '../../hooks/useKbdLabel';
import { canCaptureScreen } from '../../lib/qr/captureScreen';
import { Icon } from '../Icon';
import { useImagePaste } from './useImagePaste';
import { useQrImport } from './useQrImport';

interface Props {
  /** Текст найденного QR-кода (ссылка профиля или подписки). */
  readonly onDecoded: (text: string) => void;
}

export function QrTab({ onDecoded }: Props): JSX.Element {
  const { t, tf } = useI18n();
  const kbd = useKbdLabel();
  const { busy, problem, fromImage, fromScreen } = useQrImport(onDecoded);
  useImagePaste(fromImage);

  const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    // Сброс значения: тот же файл можно выбрать повторно.
    e.target.value = '';
    if (file !== undefined) fromImage(file);
  };

  return (
    <div className="imp-pane" role="tabpanel" id="impPane-qr" aria-labelledby="impTab-qr">
      <div className="imp-qr">
        <div className="imp-qr-frame" aria-hidden="true">
          <Icon name="qr" />
        </div>
        <p className="t2">{tf('imp.qrHint', { key: kbd('V') })}</p>
        {problem !== '' && (
          <div className="banner banner-err" role="alert" style={{ margin: 0 }}>
            <span className="ic"><Icon name="alert" /></span>
            <div className="bn-t">{problem}</div>
          </div>
        )}
        {busy && <p className="cap" role="status">{t('imp.qrBusy')}</p>}
        <div className="imp-qr-acts">
          <label className="btn btn-sec">
            <Icon name="file" />
            <span>{t('imp.qrFile')}</span>
            <input type="file" accept="image/*" className="sr-only" onChange={onPick} />
          </label>
          {canCaptureScreen() && (
            <button className="btn btn-sec" onClick={fromScreen}>
              <Icon name="monitor" />
              <span>{t('imp.qrScreen')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
