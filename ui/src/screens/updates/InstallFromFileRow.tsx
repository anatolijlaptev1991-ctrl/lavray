// SPDX-License-Identifier: GPL-3.0-only

// InstallFromFileRow.tsx — строка «Установить из файла…» (T-75): для случая, когда
// источники обновлений недоступны. Подпись установщика проверяется ядром так же
// строго; установка — командой оболочки. Показывается только в окне Tauri.
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { useLocalInstall } from '../../hooks/useLocalInstall';
import type { LocalState } from '../../hooks/useLocalInstall';

/** Ход и итог проверки файла; тексты ядра выводятся как обычный текст. */
function FileStatus({ state }: { readonly state: LocalState }): JSX.Element | null {
  const { t, tf } = useI18n();
  switch (state.kind) {
    case 'working':
      return (
        <div className="set-d" role="status" aria-busy="true">
          {t('upd.file.verifying')}
        </div>
      );
    case 'installing':
      return (
        <div className="set-d" role="status" aria-busy="true">
          {t('upd.installing')}
        </div>
      );
    case 'valid':
      return (
        <div className="set-d" role="status">
          {tf('upd.file.valid', { v: state.version })} {t('upd.sessionD')}
          {state.notice && <span style={{ display: 'block' }}>{t('upd.uacCancelled')}</span>}
        </div>
      );
    case 'invalid':
      return (
        <div className="set-d" role="alert">
          {t('upd.file.invalid')}
          <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
            {state.errors.map((line, i) => (
              <li key={`${String(i)}:${line}`}>{line}</li>
            ))}
          </ul>
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

export function InstallFromFileRow(): JSX.Element {
  const { t } = useI18n();
  const { state, pick, install } = useLocalInstall();
  const working = state.kind === 'working' || state.kind === 'installing';
  return (
    <div className="set-row" id="updFileRow">
      <div className="set-txt">
        <div className="set-l">{t('upd.fromFile')}</div>
        <div className="set-d">{t('upd.fromFileD')}</div>
        <FileStatus state={state} />
      </div>
      <div className="set-ctl" style={{ display: 'flex', gap: 8 }}>
        {state.kind === 'valid' && (
          <button className="btn btn-pri btn-sm" onClick={install}>
            {t('upd.installNow')}
          </button>
        )}
        <button className="btn btn-sec btn-sm" disabled={working} onClick={pick}>
          {t('upd.fromFile')}
        </button>
      </div>
    </div>
  );
}
