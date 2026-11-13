// SPDX-License-Identifier: GPL-3.0-only

// ShellPrefRows.tsx — строки «Закрывать в трей», «Запускать свёрнутым» и
// «Уведомления» в «Настройках → Общие» (T-82). Только в окне приложения: в
// веб-панели окна, трея и уведомлений ОС нет. Значения читает оболочка из
// ui-state.json (lib/shellPrefs.ts).
import { useState } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { useShellCaps } from '../../hooks/useShellCaps';
import type { MessageKey } from '../../lib/i18n';
import { readShellPrefs, writeShellFlag, type ShellFlag } from '../../lib/shellPrefs';

interface RowSpec {
  readonly name: ShellFlag;
  readonly labelKey: MessageKey;
  readonly descKey: MessageKey;
}

const ROWS: readonly RowSpec[] = [
  { name: 'closeToTray', labelKey: 'set.tray', descKey: 'set.trayD' },
  { name: 'startMinimized', labelKey: 'set.startMin', descKey: 'set.startMinD' },
  { name: 'notify', labelKey: 'set.notify', descKey: 'set.notifyD' },
];

function inShell(): boolean {
  return (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
}

export function ShellPrefRows(): JSX.Element | null {
  const { t } = useI18n();
  const trayAvailable = useShellCaps().trayAvailable;
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
            {!trayAvailable && row.name !== 'notify' && (
              <div className="set-d" role="note">
                {t('set.tray.na')}
              </div>
            )}
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
