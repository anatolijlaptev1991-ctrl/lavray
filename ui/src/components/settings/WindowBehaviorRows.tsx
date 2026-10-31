// SPDX-License-Identifier: GPL-3.0-only

// WindowBehaviorRows.tsx — строки «Закрывать в трей» и «Запускать свёрнутым»
// в «Настройках → Общие» (T-82). Только в окне приложения: в веб-панели окна и
// трея нет. Значения читает оболочка из ui-state.json (lib/shellPrefs.ts).
import { useState } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import type { MessageKey } from '../../lib/i18n';
import { readShellPrefs, writeShellFlag, type ShellFlag } from '../../lib/shellPrefs';

interface RowSpec {
  readonly name: Extract<ShellFlag, 'closeToTray' | 'startMinimized'>;
  readonly labelKey: MessageKey;
  readonly descKey: MessageKey;
}

const ROWS: readonly RowSpec[] = [
  { name: 'closeToTray', labelKey: 'set.tray', descKey: 'set.trayD' },
  { name: 'startMinimized', labelKey: 'set.startMin', descKey: 'set.startMinD' },
];

function inShell(): boolean {
  return (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
}

export function WindowBehaviorRows(): JSX.Element | null {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState(readShellPrefs);
  const [failed, setFailed] = useState(false);
  if (!inShell()) return null;

  const toggle = (name: RowSpec['name']): void => {
    const next = !prefs[name];
    const saved = writeShellFlag(name, next);
    setFailed(!saved);
    if (saved) setPrefs({ ...prefs, [name]: next });
  };

  return (
    <>
      {ROWS.map((row) => (
        <div className="set-row" key={row.name} id={`${row.name}Row`}>
          <div className="set-txt">
            <div className="set-l">{t(row.labelKey)}</div>
            <div className="set-d">{t(row.descKey)}</div>
          </div>
          <div className="set-ctl">
            <button
              className={`sw${prefs[row.name] ? ' on' : ''}`}
              role="switch"
              aria-checked={prefs[row.name]}
              aria-label={t(row.labelKey)}
              onClick={() => {
                toggle(row.name);
              }}
            />
          </div>
        </div>
      ))}
      {failed && (
        <div className="set-d" role="alert">
          {t('set.shellPrefFailed')}
        </div>
      )}
    </>
  );
}
