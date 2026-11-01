// SPDX-License-Identifier: GPL-3.0-only

// SessionsPanel.tsx — «Сессии веб-панели» в Настройках → Общие: список
// сессий пользователя с отзывом, выход из текущей и смена пароля. Показывается
// только внутри WebGate (в оболочке и без входа панели нет).
import { useCallback, useContext, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { SessionInfo } from '../../gen/lavray_pb';
import { useCore } from '../../hooks/useCore';
import { useI18n } from '../../hooks/useI18n';
import { friendlyCoreError } from '../../lib/core';
import { LOCALES } from '../../lib/i18n';
import { ChangePasswordForm } from './ChangePasswordForm';
import { WebSessionContext } from './WebSessionContext';

export function SessionsPanel(): JSX.Element | null {
  const ctrl = useContext(WebSessionContext);
  const { web } = useCore();
  const { t, tf, lang } = useI18n();
  const [sessions, setSessions] = useState<readonly SessionInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setSessions((await web.listSessions({})).sessions);
      setError(null);
    } catch (e) {
      setError(friendlyCoreError(e));
    }
  }, [web]);

  useEffect(() => {
    if (ctrl !== null) void refresh();
  }, [ctrl, refresh]);

  if (ctrl === null) return null;

  const revoke = async (id: string): Promise<void> => {
    try {
      await web.revokeSession({ sessionId: id });
    } catch (e) {
      setError(friendlyCoreError(e));
      return;
    }
    await refresh();
  };
  const when = (ms: bigint): string => new Date(Number(ms)).toLocaleString(LOCALES[lang]);

  return (
    <section id="webSessions" aria-labelledby="webSessionsT">
      <div className="set-row">
        <div className="set-txt">
          <div className="set-l" id="webSessionsT">
            {t('web.sess.t')} · {ctrl.username}
          </div>
        </div>
        <div className="set-ctl">
          <button
            className="btn"
            id="webLogout"
            onClick={() => {
              void ctrl.logout();
            }}
          >
            {t('web.logout')}
          </button>
        </div>
      </div>
      <ul className="set-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {sessions.map((s) => {
          const label = s.clientLabel ?? t('web.sess.unknown');
          return (
            <li className="set-row" key={s.sessionId}>
              <div className="set-txt">
                <div className="set-l">
                  {label}
                  {s.current && <span className="badge"> · {t('web.sess.current')}</span>}
                </div>
                <div className="set-d">
                  {tf('web.sess.seen', { when: when(s.lastSeenMs) })}
                  {s.remoteAddr !== undefined && ` · ${tf('web.sess.addr', { addr: s.remoteAddr })}`}
                </div>
              </div>
              <div className="set-ctl">
                {!s.current && (
                  <button
                    className="btn"
                    aria-label={`${t('web.sess.revoke')}: ${label}`}
                    onClick={() => {
                      void revoke(s.sessionId);
                    }}
                  >
                    {t('web.sess.revoke')}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error !== null && (
        <div className="set-d" role="alert">
          {error}
        </div>
      )}
      <ChangePasswordForm onChanged={() => void refresh()} />
    </section>
  );
}
