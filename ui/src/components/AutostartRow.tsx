// SPDX-License-Identifier: GPL-3.0-only

// AutostartRow.tsx — строка «Автозапуск с системой» в «Настройках» (T-82/Э-2).
// Переключатель показывает состояние самой ОС: оно читается при каждом показе
// строки и при возвращении фокуса окну, а не берётся из сохранённых настроек.
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../hooks/useI18n';
import { readAutostart, writeAutostart } from '../lib/autostart';
import { relaunchElevated } from '../lib/elevation';
import type { AutostartInfo } from '../lib/autostart';
import type { MessageKey } from '../lib/i18n';
import { Icon } from './Icon';
import { TunDialog } from './TunDialog';

/** Что пошло не так: текст собирается при показе, чтобы смена языка его перевела. */
type Problem =
  | { readonly kind: 'needAdmin' }
  | { readonly kind: 'installedOnly' }
  | { readonly kind: 'failed'; readonly detail: string };

/**
 * Повышенный экземпляр установленной копии, а автозапуск всё ещё обычный
 * (`Run`): оболочка при старте переводит его в задачу, и если значение осталось —
 * перевод не удался. TUN после входа в таком виде придётся включать вручную.
 */
function runNotUpgraded(info: AutostartInfo): boolean {
  return info.enabled && info.elevated && info.installed && info.method === 'registry';
}

/** Подсказка под переключателем по состоянию ОС. */
function detailKey(info: AutostartInfo): MessageKey {
  if (info.unknown && !info.enabled) return 'set.autostart.unknown';
  if (info.enabled) return info.method === 'task' ? 'set.autostart.viaTask' : 'set.autostart.viaRun';
  if (info.elevated) return info.installed ? 'set.autostart.willTask' : 'set.autostart.installedOnly';
  return 'set.autostart.willRun';
}

function problemText(problem: Problem, t: (key: MessageKey) => string): string {
  switch (problem.kind) {
    case 'needAdmin':
      return t('set.autostart.needAdmin');
    case 'installedOnly':
      return t('set.autostart.installedOnly');
    case 'failed':
      return `${t('set.autostart.failed')}: ${problem.detail}`;
  }
}

export function AutostartRow(): JSX.Element | null {
  const { t } = useI18n();
  // null — состояние неизвестно или автозапуск здесь не поддерживается: строки нет.
  const [info, setInfo] = useState<AutostartInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [relaunchOpen, setRelaunchOpen] = useState(false);

  // Неудачное повторное чтение не стирает уже показанное состояние.
  const refresh = useCallback(async (): Promise<void> => {
    const next = await readAutostart();
    setInfo((prev) => next ?? prev);
  }, []);

  useEffect(() => {
    let live = true;
    const reload = (): void => {
      void readAutostart().then((next) => {
        if (live) setInfo((prev) => next ?? prev);
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
        if (next.notice === 'task_needs_admin') setProblem({ kind: 'needAdmin' });
        else if (next.notice === 'task_installed_only') setProblem({ kind: 'installedOnly' });
      } catch (e) {
        setProblem({ kind: 'failed', detail: e instanceof Error ? e.message : String(e) });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  // Выключить автозапуск задачей или перейти на неё можно только с правами
  // администратора: предлагаем перезапуск (тот же relaunch_elevated, что и у TUN).
  const needsAdmin =
    info !== null &&
    !info.elevated &&
    (info.method === 'task' || problem?.kind === 'needAdmin' || (!info.enabled && info.installed));

  // Сообщение об ошибке показывается и когда состояние ОС прочитать не удалось.
  if (info === null && problem === null) return null;
  return (
    <>
      {info !== null && (
        <div className="set-row" id="autostartRow">
          <div className="set-txt">
            <div className="set-l">{t('set.autostart')}</div>
            <div className="set-d">{t('set.autostartD')}</div>
            {!runNotUpgraded(info) && (
              <div className="set-d" role="status">
                {t(detailKey(info))}
              </div>
            )}
            {needsAdmin && (
              <button
                className="btn btn-sec btn-sm"
                id="autostartRelaunch"
                onClick={() => {
                  setRelaunchOpen(true);
                }}
              >
                {t('tun.dlg.ok')}
              </button>
            )}
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
      )}
      {info !== null && runNotUpgraded(info) && (
        <div className="banner banner-warn" role="alert" id="autostartStuck">
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="bn-t">{t('set.autostart.runStuck')}</div>
        </div>
      )}
      {problem !== null && (
        <div className="banner banner-warn" role="alert">
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="bn-t">{problemText(problem, t)}</div>
        </div>
      )}
      {relaunchOpen && (
        <TunDialog
          purpose="autostart"
          onClose={() => {
            setRelaunchOpen(false);
          }}
          onRelaunch={relaunchElevated}
        />
      )}
    </>
  );
}
