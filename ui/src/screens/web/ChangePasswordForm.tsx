// SPDX-License-Identifier: GPL-3.0-only

// ChangePasswordForm.tsx — смена пароля веб-панели. Ядро отзывает все остальные
// сессии и сообщает, сколько их было.
import { useId, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { Code, ConnectError } from '@connectrpc/connect';
import { useCore } from '../../hooks/useCore';
import { useI18n } from '../../hooks/useI18n';
import { friendlyCoreError } from '../../lib/core';
import { passwordProblem, type WebMessage } from '../../lib/webSession';
import { messageText } from './messageText';

export function ChangePasswordForm({ onChanged }: { readonly onChanged: () => void }): JSX.Element {
  const { web } = useCore();
  const { t, tf } = useI18n();
  const ids = { old: useId(), next: useId(), msg: useId() };
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<WebMessage | null>(null);
  const [failed, setFailed] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const problem = oldPw === '' ? { key: 'web.login.empty' as const } : passwordProblem(newPw);
    if (problem !== null) {
      setFailed(true);
      setMessage(problem);
      return;
    }
    setBusy(true);
    try {
      const res = await web.changePassword({ oldPassword: oldPw, newPassword: newPw });
      setFailed(false);
      setMessage({ key: 'web.pw.done', params: { n: res.revokedOtherSessions } });
      setOldPw('');
      setNewPw('');
      onChanged();
    } catch (err) {
      setFailed(true);
      setMessage(
        err instanceof ConnectError && err.code === Code.InvalidArgument
          ? { key: 'web.pw.wrong' }
          : { text: friendlyCoreError(err) },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="set-row"
      onSubmit={(e) => {
        void submit(e);
      }}
      aria-label={t('web.pw.t')}
      noValidate
    >
      <div className="set-txt">
        <div className="set-l">{t('web.pw.t')}</div>
        <div className={`field${failed ? ' invalid' : ''}`}>
          <label htmlFor={ids.old}>{t('web.pw.old')}</label>
          <input
            id={ids.old}
            className="input"
            type="password"
            autoComplete="current-password"
            value={oldPw}
            aria-invalid={failed}
            onChange={(e) => {
              setOldPw(e.target.value);
            }}
          />
        </div>
        <div className={`field${failed ? ' invalid' : ''}`}>
          <label htmlFor={ids.next}>{t('web.pw.new')}</label>
          <input
            id={ids.next}
            className="input"
            type="password"
            autoComplete="new-password"
            value={newPw}
            aria-invalid={failed}
            aria-describedby={ids.msg}
            onChange={(e) => {
              setNewPw(e.target.value);
            }}
          />
        </div>
        <div id={ids.msg} className={failed ? 'field-err' : 'set-d'} role={failed ? 'alert' : 'status'} style={failed ? { display: 'block' } : undefined}>
          {message === null ? '' : messageText(message, t, tf)}
        </div>
      </div>
      <div className="set-ctl">
        <button className="btn" type="submit" disabled={busy}>
          {t('web.pw.go')}
        </button>
      </div>
    </form>
  );
}
