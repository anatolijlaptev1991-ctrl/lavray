// SPDX-License-Identifier: GPL-3.0-only

// AutostartRow.tsx — строка «Автозапуск с системой» в «Настройках» (T-82/Э-2).
// Переключатель показывает состояние самой ОС: оно читается при каждом показе
// строки и при возвращении фокуса окну, а не берётся из сохранённых настроек.
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../hooks/useI18n';
import { readAutostart, writeAutostart } from '../lib/autostart';
import type { AutostartInfo } from '../lib/autostart';
import { Icon } from './Icon';

export function AutostartRow(): JSX.Element | null {
  const { t } = useI18n();
  // null — состояние неизвестно или автозапуск здесь не поддерживается: строки нет.
  const [info, setInfo] = useState<AutostartInfo | null>(null);
  const [busy, setBusy] = useState(false);
  // Что пошло не так: текст собирается при показе, чтобы смена языка его перевела.
  const [problem, setProblem] = useState<{ readonly detail: string | null } | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setInfo(await readAutostart());
  }, []);

  useEffect(() => {
    let live = true;
    const reload = (): void => {
      void readAutostart().then((next) => {
        if (live) setInfo(next);
      });
    };
    reload();
    window.addEventListener('focus', reload);
    return (): void => {
      live = false;
      window.removeEventListener('focus', reload);
    };
  }, []);

  const toggle = useCallback(
    async (enabled: boolean): Promise<void> => {
      setBusy(true);
      setProblem(null);
      try {
        const next = await writeAutostart(enabled);
        setInfo(next);
        if (next.needsAdmin) setProblem({ detail: null });
      } catch (e) {
        setProblem({ detail: e instanceof Error ? e.message : String(e) });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  if (info === null) return null;
  const detail = info.enabled
    ? t(info.method === 'task' ? 'set.autostart.viaTask' : 'set.autostart.viaRun')
    : t(info.elevated ? 'set.autostart.willTask' : 'set.autostart.willRun');
  return (
    <>
      <div className="set-row" id="autostartRow">
        <div className="set-txt">
          <div className="set-l">{t('set.autostart')}</div>
          <div className="set-d">{t('set.autostartD')}</div>
          <div className="set-d" role="status">
            {detail}
          </div>
        </div>
        <div className="set-ctl">
          <button
            className={`sw${info.enabled ? ' on' : ''}`}
            role="switch"
            aria-checked={info.enabled}
            aria-label={t('set.autostart')}
            disabled={busy}
            onClick={() => {
              void toggle(!info.enabled);
            }}
          />
        </div>
      </div>
      {problem !== null && (
        <div className="banner banner-warn" role="alert">
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="bn-t">
            {problem.detail === null
              ? t('set.autostart.needAdmin')
              : `${t('set.autostart.failed')}: ${problem.detail}`}
          </div>
        </div>
      )}
    </>
  );
}
