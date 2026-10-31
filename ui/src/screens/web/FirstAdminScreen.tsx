// SPDX-License-Identifier: GPL-3.0-only

// FirstAdminScreen.tsx — первичная настройка: создание администратора веб-панели
// (показывается, пока в ядре нет ни одного пользователя). Пароль проверяется
// на клиенте по той же политике, что в ядре (lib/webSession.ts).
import { useId, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { BrandMark } from '../../components/BrandMark';
import { useI18n } from '../../hooks/useI18n';
import { MIN_PASSWORD_LENGTH, type WebMessage } from '../../lib/webSession';
import { InsecureBanner } from './InsecureBanner';
import { messageText } from './messageText';

export interface FirstAdminScreenProps {
  readonly busy: boolean;
  readonly message: WebMessage | null;
  readonly onSubmit: (username: string, password: string, confirm: string) => void;
}

export function FirstAdminScreen({ busy, message, onSubmit }: FirstAdminScreenProps): JSX.Element {
  const { t, tf } = useI18n();
  const ids = { title: useId(), hint: useId(), user: useId(), pw: useId(), pw2: useId(), err: useId() };
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const invalid = message !== null;

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    onSubmit(username, password, confirm);
  };

  return (
    <div id="webLogin">
      <form className="wl-card" onSubmit={submit} aria-labelledby={ids.title} noValidate>
        <BrandMark size={28} />
        <h2 id={ids.title}>{t('web.setup.t')}</h2>
        <p className="cap" id={ids.hint}>
          {tf('web.setup.sub', { n: MIN_PASSWORD_LENGTH })}
        </p>
        <InsecureBanner variant="card" />
        <div className="field">
          <label htmlFor={ids.user}>{t('web.login.user')}</label>
          <input
            id={ids.user}
            className="input"
            value={username}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => {
              setUsername(e.target.value);
            }}
          />
        </div>
        <div className={`field${invalid ? ' invalid' : ''}`}>
          <label htmlFor={ids.pw}>{t('web.login.pw')}</label>
          <input
            id={ids.pw}
            className="input"
            type="password"
            value={password}
            autoComplete="new-password"
            aria-invalid={invalid}
            aria-describedby={`${ids.hint} ${ids.err}`}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </div>
        <div className={`field${invalid ? ' invalid' : ''}`}>
          <label htmlFor={ids.pw2}>{t('web.setup.confirm')}</label>
          <input
            id={ids.pw2}
            className="input"
            type="password"
            value={confirm}
            autoComplete="new-password"
            aria-invalid={invalid}
            aria-describedby={ids.err}
            onChange={(e) => {
              setConfirm(e.target.value);
            }}
          />
          <span id={ids.err} className="field-err" role="alert">
            {message === null ? '' : messageText(message, t, tf)}
          </span>
        </div>
        <button className="btn btn-pri" type="submit" disabled={busy}>
          {t('web.setup.go')}
        </button>
      </form>
    </div>
  );
}
