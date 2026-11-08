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

export function AutoConnectRow(): JSX.Element | null {
  const { t } = useI18n();
  const core = useCore();
  // null — значение ещё не прочитано: переключатель недоступен.
  const [on, setOn] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const shell = inShell();

  useEffect(() => {
    if (!shell) return;
    const guard = { live: true };
    core.settings
      .getSettings({ keys: [REMEMBER_ENABLE_KEY] })
      .then((res) => {
        const value = res.values[REMEMBER_ENABLE_KEY]?.value;
        if (guard.live) setOn(value?.case === 'boolValue' && value.value);
      })
      .catch(() => {
        if (guard.live) setOn(null);
      });
    return (): void => {
      guard.live = false;
    };
  }, [core, shell]);

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

  if (!shell) return null;
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
            className={`sw${on === true ? ' on' : ''}`}
            role="switch"
            aria-checked={on === true}
            aria-labelledby="autoConnectLabel"
            aria-describedby="autoConnectDesc"
            disabled={on === null}
            onClick={() => {
              void toggle(on !== true);
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
