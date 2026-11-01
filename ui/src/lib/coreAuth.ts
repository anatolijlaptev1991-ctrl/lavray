// SPDX-License-Identifier: GPL-3.0-only

// coreAuth.ts — как клиент ядра подтверждает себя (T-76). Два режима:
// - bearer: заголовок Authorization с токеном (нативная оболочка, headless);
// - cookie: веб-панель — cookie сессии (HttpOnly, уходит сама благодаря
//   credentials: 'include') и CSRF-заголовок X-Lavray-CSRF на каждом запросе:
//   Connect шлёт все вызовы методом POST, то есть все они изменяющие.
import { Code, ConnectError, type Interceptor } from '@connectrpc/connect';

/** Заголовок CSRF-токена сессии (значение выдаёт Login/WhoAmI). */
export const CSRF_HEADER = 'X-Lavray-CSRF';

export type AuthMode = 'bearer' | 'cookie';

export interface CoreAuth {
  /** Bearer-токен ядра (нативный режим, headless). */
  token?: string;
  /** По умолчанию bearer. */
  mode?: AuthMode;
  /** Источник CSRF-токена текущей сессии (режим cookie). */
  csrf?: () => string;
}

/** fetch для режима cookie: cookie сессии отправляется с каждым запросом. */
export const cookieFetch: typeof fetch = (input, init) =>
  globalThis.fetch(input, { ...init, credentials: 'include' });

const expiredListeners = new Set<() => void>();

/** Подписка на «сессия истекла» (любой RPC ядра ответил Unauthenticated). */
export function onSessionExpired(listener: () => void): () => void {
  expiredListeners.add(listener);
  return (): void => {
    expiredListeners.delete(listener);
  };
}

// Вызовы самого входа сообщают об ошибках сами: неверный пароль — не «сессия истекла».
const OWN_ERRORS_SERVICE = `lavray.v1.WebSessionService`;

/** Перехватчики транспорта по режиму авторизации. */
export function authInterceptors(auth: CoreAuth | undefined): Interceptor[] {
  if (auth?.mode === 'cookie') {
    const csrf = auth.csrf;
    return [
      (next) => async (req) => {
        const token = csrf?.() ?? '';
        if (token !== '') req.header.set(CSRF_HEADER, token);
        try {
          return await next(req);
        } catch (e) {
          if (
            e instanceof ConnectError &&
            e.code === Code.Unauthenticated &&
            req.service.typeName !== OWN_ERRORS_SERVICE
          ) {
            expiredListeners.forEach((l) => {
              l();
            });
          }
          throw e;
        }
      },
    ];
  }
  const token = auth?.token ?? '';
  if (token === '') return [];
  return [
    (next) => async (req) => {
      req.header.set('Authorization', `Bearer ${token}`);
      return next(req);
    },
  ];
}
