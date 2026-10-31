// SPDX-License-Identifier: GPL-3.0-only

// useWebSession.ts — состояние входа в веб-панель (T-76). Фазы:
//   loading → none   ядро без веб-панели (UNIMPLEMENTED): вход не нужен;
//           → setup  администратора ещё нет (первичная настройка);
//           → login  нужна авторизация;
//           → ready  сессия действует, CSRF-токен выдан;
//           → error  ядро недоступно (кнопка «Повторить»).
// Пароль не хранится: хук передаёт его в запрос и забывает.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Code, ConnectError } from '@connectrpc/connect';
import type { CoreClients } from '../lib/core';
import { friendlyCoreError } from '../lib/core';
import { onSessionExpired } from '../lib/coreAuth';
import { authFailure, passwordProblem, retryAfterSeconds, setCsrfToken, type WebMessage } from '../lib/webSession';

export type WebPhase = 'loading' | 'none' | 'error' | 'setup' | 'login' | 'ready';

export interface WebSessionApi {
  readonly phase: WebPhase;
  readonly username: string;
  readonly busy: boolean;
  /** Ошибка или уведомление формы (неверный пароль, «сессия истекла»). */
  readonly message: WebMessage | null;
  /** До какого момента (мс) вход закрыт лимитером; null — открыт. */
  readonly lockedUntil: number | null;
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string, confirm: string) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
}

const codeOf = (e: unknown): Code | null => (e instanceof ConnectError ? e.code : null);

export function useWebSession(web: CoreClients['web']): WebSessionApi {
  const [phase, setPhase] = useState<WebPhase>('loading');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<WebMessage | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const phaseRef = useRef<WebPhase>('loading');
  const alive = useRef(true);

  const go = useCallback((next: WebPhase): void => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const open = useCallback(
    (name: string, csrf: string | undefined): void => {
      setCsrfToken(csrf ?? '');
      setUsername(name);
      setMessage(null);
      setLockedUntil(null);
      go('ready');
    },
    [go],
  );

  const probe = useCallback(async (): Promise<void> => {
    go('loading');
    try {
      if ((await web.getWebModeStatus({})).firstRunSetupRequired) {
        if (alive.current) go('setup');
        return;
      }
      const me = await web.whoAmI({});
      if (alive.current) open(me.username, me.csrfToken);
    } catch (e) {
      if (!alive.current) return;
      const code = codeOf(e);
      go(code === Code.Unimplemented ? 'none' : code === Code.Unauthenticated ? 'login' : 'error');
    }
  }, [web, go, open]);

  useEffect(() => {
    alive.current = true;
    void probe();
    return (): void => {
      alive.current = false;
    };
  }, [probe]);

  // Сессия истекла посреди работы: назад на экран входа с пояснением.
  useEffect(
    () =>
      onSessionExpired(() => {
        if (phaseRef.current !== 'ready') return;
        setCsrfToken('');
        setMessage({ key: 'web.login.expired' });
        go('login');
      }),
    [go],
  );

  const onFailure = useCallback(
    async (kind: 'login' | 'setup', e: unknown): Promise<void> => {
      if (codeOf(e) === Code.FailedPrecondition) {
        if (kind === 'login') {
          await probe(); // администратора нет — первичная настройка
          return;
        }
        setMessage({ key: 'web.setup.exists' });
        go('login');
        return;
      }
      const wait = retryAfterSeconds(e);
      setLockedUntil(wait === null ? null : Date.now() + wait * 1000);
      setMessage(authFailure(e, (x) => friendlyCoreError(x)));
    },
    [probe, go],
  );

  const submit = useCallback(
    async (kind: 'login' | 'setup', name: string, password: string): Promise<void> => {
      setBusy(true);
      setMessage(null);
      try {
        const body = { username: name.trim(), password };
        const res = kind === 'login' ? await web.login(body) : await web.setupFirstAdmin(body);
        open(res.username, res.csrfToken);
      } catch (e) {
        await onFailure(kind, e);
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [web, open, onFailure],
  );

  const login = useCallback(
    async (name: string, password: string): Promise<void> => {
      if (name.trim() === '' || password === '') {
        setMessage({ key: 'web.login.empty' });
        return;
      }
      await submit('login', name, password);
    },
    [submit],
  );

  const setup = useCallback(
    async (name: string, password: string, confirm: string): Promise<void> => {
      const problem = name.trim() === '' ? { key: 'web.login.empty' as const } : passwordProblem(password, confirm);
      if (problem !== null) {
        setMessage(problem);
        return;
      }
      await submit('setup', name, password);
    },
    [submit],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await web.logout({});
    } catch {
      /* сессия могла уже истечь — локально выходим в любом случае */
    }
    setCsrfToken('');
    setUsername('');
    setMessage(null);
    go('login');
  }, [web, go]);

  const retry = useCallback((): void => {
    void probe();
  }, [probe]);

  return { phase, username, busy, message, lockedUntil, login, setup, logout, retry };
}
