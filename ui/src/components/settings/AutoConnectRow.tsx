// SPDX-License-Identifier: GPL-3.0-only

// AutoConnectRow.tsx — «Подключаться автоматически при запуске» в «Настройках →
// Общие», рядом с автозапуском. Переключает настройку ядра `remember.enable`
// (по умолчанию выключена): при старте оболочка просит ядро один раз
// подключить последний успешно подключённый сервер и режим (`--connect-last`).
// Только в окне приложения: в веб-панели ядро запущено не оболочкой.
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { create } from '@bufbuild/protobuf';
import { SettingValueSchema } from '../../gen/lavray_pb';
import { useCore } from '../../hooks/useCore';
import { useI18n } from '../../hooks/useI18n';

/** Ключ настройки ядра. */
export const REMEMBER_ENABLE_KEY = 'remember.enable';

function inShell(): boolean {
  return (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
}

interface Props {
  /** Значение `remember.enable`, уже прочитанное экраном настроек (отдельного запроса нет). */
  readonly value: boolean;
}

export function AutoConnectRow({ value }: Props): JSX.Element | null {
  const { t } = useI18n();
  const core = useCore();
  const [on, setOn] = useState(value);
  const [failed, setFailed] = useState(false);

  // Экран перечитал настройки (импорт, откат) — следуем за ядром.
  useEffect(() => {
    setOn(value);
  }, [value]);

  const toggle = useCallback(
    async (next: boolean): Promise<void> => {
      setFailed(false);
      try {
        await core.settings.setSettings({
          values: { [REMEMBER_ENABLE_KEY]: create(SettingValueSchema, { value: { case: 'boolValue', value: next } }) },
        });
        setOn(next);
      } catch {
        setFailed(true);
      }
    },
    [core],
  );

  if (!inShell()) return null;
  return (
    <>
      <div className="set-row" id="autoConnectRow">
        <div className="set-txt">
          <div className="set-l" id="autoConnectLabel">
            {t('set.autoConnect')}
          </div>
          <div className="set-d" id="autoConnectDesc">
            {t('set.autoConnect.d')}
          </div>
        </div>
        <div className="set-ctl">
          <button
            className={`sw${on ? ' on' : ''}`}
            role="switch"
            aria-checked={on}
            aria-labelledby="autoConnectLabel"
            aria-describedby="autoConnectDesc"
            onClick={() => {
              void toggle(!on);
            }}
          />
        </div>
      </div>
      {failed && (
        <div className="set-d" role="alert">
          {t('set.autoConnect.failed')}
        </div>
      )}
    </>
  );
}
