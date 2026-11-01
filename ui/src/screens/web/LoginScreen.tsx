// SPDX-License-Identifier: GPL-3.0-only

// LoginScreen.tsx — вход в веб-панель (прототип #webLogin). Подписи связаны с
// полями (label/for), ошибка — role="alert" и aria-describedby, поля помечаются
// aria-invalid; при блокировке лимитером кнопка недоступна до конца паузы.
import { useId, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { BrandMark } from '../../components/BrandMark';
import { useI18n } from '../../hooks/useI18n';
import { useLocked } from '../../hooks/useLocked';
import type { WebMessage } from '../../lib/webSession';
import { InsecureBanner } from './InsecureBanner';
import { messageText } from './messageText';

export interface LoginScreenProps {
  readonly busy: boolean;
  readonly message: WebMessage | null;
  readonly lockedUntil: number | null;
  readonly onSubmit: (username: string, password: string) => void;
}

export function LoginScreen({ busy, message, lockedUntil, onSubmit }: LoginScreenProps): JSX.Element {
  const { t, tf } = useI18n();
  const ids = { title: useId(), user: useId(), pw: useId(), err: useId() };
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const locked = useLocked(lockedUntil);
  const invalid = message !== null;

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    onSubmit(username, password);
    setPassword('');
  };

  return (
    <div id="webLogin">
      <form className="wl-card" onSubmit={submit} aria-labelledby={ids.title} noValidate>
        <BrandMark size={28} />
        <h2 id={ids.title}>{t('web.login.t')}</h2>
        <p className="cap">{tf('web.login.sub', { host: window.location.host })}</p>
        <InsecureBanner variant="card" />
        <div className={`field${invalid ? ' invalid' : ''}`}>
          <label htmlFor={ids.user}>{t('web.login.user')}</label>
          <input
            id={ids.user}
            className="input"
            value={username}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            aria-invalid={invalid}
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
            autoComplete="current-password"
            aria-invalid={invalid}
            aria-describedby={ids.err}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
          <span id={ids.err} className="field-err" role="alert">
            {message === null ? '' : messageText(message, t, tf)}
          </span>
        </div>
        <button className="btn btn-pri" type="submit" disabled={busy || locked}>
          {t('web.login.go')}
        </button>
      </form>
    </div>
  );
}
