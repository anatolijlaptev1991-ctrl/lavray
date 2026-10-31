// SPDX-License-Identifier: GPL-3.0-only

// GlobalHotkeyRow.tsx — строка «Глобальное сочетание: подключить/отключить» в
// разделе «Горячие клавиши» (T-82). По умолчанию выключено. Только в окне
// приложения. Сохранённое сочетание (ui-state.json) оболочка регистрирует при
// запуске; здесь его задают и снимают.
import { useState } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { hotkeyErrorKey, setGlobalHotkey } from '../../lib/globalHotkey';
import { readShellPrefs, writeHotkeyConnect } from '../../lib/shellPrefs';
import { HotkeyCaptureDialog } from './HotkeyCaptureDialog';

function inShell(): boolean {
  return (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
}

export function GlobalHotkeyRow(): JSX.Element | null {
  const { t } = useI18n();
  const [accel, setAccel] = useState(() => readShellPrefs().hotkeyConnect);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!inShell()) return null;

  const clear = async (): Promise<void> => {
    try {
      await setGlobalHotkey(null);
      writeHotkeyConnect(null);
      setAccel(null);
      setError(null);
    } catch (e) {
      setError(t(hotkeyErrorKey(e instanceof Error ? e.message : '')));
    }
  };

  return (
    <div className="set-row" id="globalHotkeyRow">
      <div className="set-txt">
        <div className="set-l">{t('hk.global')}</div>
        <div className="set-d">{t('hk.globalD')}</div>
        {error !== null && (
          <div className="set-d" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="set-ctl">
        <kbd className="kbd" aria-live="polite">
          {accel ?? t('hk.globalOff')}
        </kbd>
        <button
          className="btn btn-sec btn-sm"
          onClick={() => {
            setCapturing(true);
          }}
        >
          {t('hk.globalSet')}
        </button>
        {accel !== null && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              void clear();
            }}
          >
            {t('hk.globalClear')}
          </button>
        )}
      </div>
      {capturing && (
        <HotkeyCaptureDialog
          onSaved={(saved) => {
            writeHotkeyConnect(saved);
            setAccel(saved);
            setError(null);
            setCapturing(false);
          }}
          onClose={() => {
            setCapturing(false);
          }}
        />
      )}
    </div>
  );
}
