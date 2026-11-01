// SPDX-License-Identifier: GPL-3.0-only

// WebGate.test.tsx — ворота веб-панели целиком: первичная настройка, вход,
// перезагрузка страницы с живой сессией, блокировка, выход, истёкшая сессия,
// ядро без веб-панели (VC). Ядро подменено на уровне fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { CoreContext } from '../../hooks/useCore';
import { createCoreClients } from '../../lib/core';
import { setLanguage } from '../../lib/i18n';
import { getCsrfToken, setCsrfToken } from '../../lib/webSession';
import { click, flush, mountBare, unmountAll, type Mounted } from '../../test-utils/coreStub';
import { buttonByText, failure, fieldByLabel, stubWebCore, typeInto, unauthenticated } from '../../test-utils/webKit';
import { SessionsPanel } from './SessionsPanel';
import { WebGate } from './WebGate';

const BASE = 'http://localhost:3000'; // адрес страницы в jsdom → клиенты ходят на него же
const session = (csrf = 'csrf-1'): { body: unknown } => ({
  body: { username: 'admin', csrfToken: csrf, expiresAtMs: '9999999999999', permissions: ['*'] },
});
const STATUS = 'WebSessionService/GetWebModeStatus';

beforeEach(() => {
  setLanguage('en');
  setCsrfToken('');
});
afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
  setCsrfToken('');
});

const app = (): ReturnType<typeof createElement> => createElement('div', { id: 'app-child' }, 'APP');
const mountGate = (child = app()): Promise<Mounted> => mountBare(createElement(WebGate, null, child));
const heading = (c: HTMLElement): string => c.querySelector('h2')?.textContent ?? '';
const alertText = (c: HTMLElement): string => c.querySelector('[role="alert"]')?.textContent ?? '';

describe('первичная настройка', () => {
  it('first_admin_flow: короткий пароль и несовпадение отклоняются на клиенте, верный вход открывает приложение', async () => {
    const core = stubWebCore({ [STATUS]: { body: { firstRunSetupRequired: true } }, 'WebSessionService/SetupFirstAdmin': session() });
    const v = await mountGate();
    expect(heading(v.container)).toBe('First-time setup');
    expect(v.container.querySelector('#app-child')).toBeNull();

    const go = (): HTMLButtonElement | null => buttonByText(v.container, 'Create and sign in');
    typeInto(fieldByLabel(v.container, 'Password'), 'short');
    typeInto(fieldByLabel(v.container, 'Repeat the password'), 'short');
    await click(go());
    expect(alertText(v.container)).toBe('The password must be at least 10 characters');
    typeInto(fieldByLabel(v.container, 'Password'), 'correct-horse-1');
    typeInto(fieldByLabel(v.container, 'Repeat the password'), 'correct-horse-2');
    await click(go());
    expect(alertText(v.container)).toBe('The passwords do not match');
    expect(core.calls.some((c) => c.rpc === 'WebSessionService/SetupFirstAdmin')).toBe(false);

    typeInto(fieldByLabel(v.container, 'Repeat the password'), 'correct-horse-1');
    await click(go());
    const setup = core.calls.find((c) => c.rpc === 'WebSessionService/SetupFirstAdmin');
    expect(setup?.body).toEqual({ username: 'admin', password: 'correct-horse-1' });
    expect(setup?.init?.credentials).toBe('include');
    expect(v.container.querySelector('#app-child')?.textContent).toBe('APP');
    expect(getCsrfToken()).toBe('csrf-1');
  });
});

describe('вход', () => {
  it('перезагрузка страницы: живая сессия по cookie открывает приложение без формы', async () => {
    const core = stubWebCore({ [STATUS]: { body: {} }, 'WebSessionService/WhoAmI': session('csrf-reload') });
    const v = await mountGate();
    expect(v.container.querySelector('#app-child')).not.toBeNull();
    expect(getCsrfToken()).toBe('csrf-reload');
    expect(core.calls.map((c) => c.rpc)).toEqual([STATUS, 'WebSessionService/WhoAmI']);
  });

  it('нет сессии → форма; неверный пароль → общая ошибка и очищенный пароль; верный → приложение', async () => {
    const core = stubWebCore({
      [STATUS]: { body: {} },
      'WebSessionService/WhoAmI': unauthenticated('требуется вход'),
      'WebSessionService/Login': (n) => (n === 0 ? unauthenticated() : session('csrf-login')),
    });
    const v = await mountGate();
    expect(heading(v.container)).toBe('Sign in to LAVRay');
    typeInto(fieldByLabel(v.container, 'Username'), 'admin');
    const pw = fieldByLabel(v.container, 'Password');
    typeInto(pw, 'wrong-password-1');
    await click(buttonByText(v.container, 'Sign in'));
    expect(alertText(v.container)).toBe('Wrong username or password');
    expect(pw?.value).toBe('');
    expect(v.container.querySelector('#app-child')).toBeNull();

    typeInto(pw, 'correct-horse-1');
    await click(buttonByText(v.container, 'Sign in'));
    expect(v.container.querySelector('#app-child')).not.toBeNull();
    expect(getCsrfToken()).toBe('csrf-login');
    const logins = core.calls.filter((c) => c.rpc === 'WebSessionService/Login');
    expect(logins.map((c) => c.body)).toEqual([
      { username: 'admin', password: 'wrong-password-1' },
      { username: 'admin', password: 'correct-horse-1' },
    ]);
  });

  it('пустые поля не уходят в ядро', async () => {
    const core = stubWebCore({ [STATUS]: { body: {} }, 'WebSessionService/WhoAmI': unauthenticated() });
    const v = await mountGate();
    await click(buttonByText(v.container, 'Sign in'));
    expect(alertText(v.container)).toBe('Enter the password');
    expect(core.calls.some((c) => c.rpc === 'WebSessionService/Login')).toBe(false);
  });

  it('блокировка лимитером: Retry-After показывается, кнопка недоступна', async () => {
    stubWebCore({
      [STATUS]: { body: {} },
      'WebSessionService/WhoAmI': unauthenticated(),
      'WebSessionService/Login': failure(429, 'resource_exhausted', { 'Retry-After': '30' }),
    });
    const v = await mountGate();
    typeInto(fieldByLabel(v.container, 'Username'), 'admin');
    typeInto(fieldByLabel(v.container, 'Password'), 'x');
    await click(buttonByText(v.container, 'Sign in'));
    expect(alertText(v.container)).toBe('Too many sign-in attempts. Try again in 30 s');
    expect(buttonByText(v.container, 'Sign in')?.disabled).toBe(true);
  });

  it('вход без созданного администратора переводит на первичную настройку', async () => {
    stubWebCore({
      [STATUS]: (n) => ({ body: n === 0 ? {} : { firstRunSetupRequired: true } }),
      'WebSessionService/WhoAmI': unauthenticated(),
      'WebSessionService/Login': failure(400, 'failed_precondition'),
    });
    const v = await mountGate();
    typeInto(fieldByLabel(v.container, 'Username'), 'admin');
    typeInto(fieldByLabel(v.container, 'Password'), 'correct-horse-1');
    await click(buttonByText(v.container, 'Sign in'));
    expect(heading(v.container)).toBe('First-time setup');
  });
});

describe('ядро без веб-панели и сбои', () => {
  it('UNIMPLEMENTED (десктоп, dev) — вход не нужен, приложение открыто', async () => {
    stubWebCore({ [STATUS]: failure(501, 'unimplemented') });
    const v = await mountGate();
    expect(v.container.querySelector('#app-child')).not.toBeNull();
  });

  it('ядро недоступно → сообщение и «Повторить»; повтор открывает форму', async () => {
    const core = stubWebCore({
      [STATUS]: (n) => (n === 0 ? failure(503, 'unavailable') : { body: {} }),
      'WebSessionService/WhoAmI': unauthenticated(),
    });
    const v = await mountGate();
    expect(alertText(v.container)).toBe('Could not reach the core. Check that it is running.');
    await click(buttonByText(v.container, 'Retry'));
    expect(heading(v.container)).toBe('Sign in to LAVRay');
    expect(core.calls.filter((c) => c.rpc === STATUS)).toHaveLength(2);
  });
});

describe('выход и истёкшая сессия', () => {
  const withPanel = (base = BASE): ReturnType<typeof createElement> =>
    createElement(
      CoreContext.Provider,
      { value: createCoreClients(base, { mode: 'cookie', csrf: getCsrfToken }) },
      createElement(SessionsPanel),
    );

  it('logout_clears_session: Logout уходит с CSRF, токен забыт, снова форма входа', async () => {
    const core = stubWebCore({
      [STATUS]: { body: {} },
      'WebSessionService/WhoAmI': session('csrf-out'),
      'WebSessionService/ListSessions': { body: { sessions: [] } },
    });
    const v = await mountGate(withPanel());
    expect(v.container.querySelector('#webSessions')).not.toBeNull();
    await click(buttonByText(v.container, 'Sign out'));
    const out = core.calls.find((c) => c.rpc === 'WebSessionService/Logout');
    expect(out?.headers.get('X-Lavray-CSRF')).toBe('csrf-out');
    expect(getCsrfToken()).toBe('');
    expect(heading(v.container)).toBe('Sign in to LAVRay');
    expect(v.container.querySelector('#webSessions')).toBeNull();
  });

  it('выход проходит и при ошибке Logout (сессия уже истекла)', async () => {
    stubWebCore({
      [STATUS]: { body: {} },
      'WebSessionService/WhoAmI': session(),
      'WebSessionService/ListSessions': { body: { sessions: [] } },
      'WebSessionService/Logout': unauthenticated(),
    });
    const v = await mountGate(withPanel());
    await click(buttonByText(v.container, 'Sign out'));
    expect(heading(v.container)).toBe('Sign in to LAVRay');
    expect(getCsrfToken()).toBe('');
  });

  it('сессия истекла посреди работы → форма входа с пояснением', async () => {
    stubWebCore({
      [STATUS]: { body: {} },
      'WebSessionService/WhoAmI': session(),
      'CoreService/GetStatus': unauthenticated('требуется вход'),
    });
    const v = await mountGate();
    expect(v.container.querySelector('#app-child')).not.toBeNull();
    await createCoreClients(BASE, { mode: 'cookie', csrf: getCsrfToken }).core.getStatus({}).catch(() => undefined);
    await flush();
    expect(heading(v.container)).toBe('Sign in to LAVRay');
    expect(alertText(v.container)).toBe('Your session has expired. Sign in again.');
    expect(getCsrfToken()).toBe('');
  });
});

describe('код первичной настройки (панель не на loopback)', () => {
  const SETUP = 'WebSessionService/SetupFirstAdmin';

  it('поле кода есть только когда ядро его требует; код уходит в SetupFirstAdmin', async () => {
    const core = stubWebCore({
      [STATUS]: { body: { firstRunSetupRequired: true, setupCodeRequired: true } },
      [SETUP]: session('csrf-code'),
    });
    const v = await mountGate();
    const code = fieldByLabel(v.container, 'Setup code');
    expect(code).not.toBeNull();
    typeInto(fieldByLabel(v.container, 'Password'), 'correct-horse-1');
    typeInto(fieldByLabel(v.container, 'Repeat the password'), 'correct-horse-1');
    typeInto(code, 'ABCDE23456');
    await click(buttonByText(v.container, 'Create and sign in'));
    expect(core.calls.find((c) => c.rpc === SETUP)?.body).toEqual({
      username: 'admin',
      password: 'correct-horse-1',
      setupCode: 'ABCDE23456',
    });
    expect(v.container.querySelector('#app-child')).not.toBeNull();
  });

  it('без требования кода поле не показывается и setupCode не отправляется', async () => {
    const core = stubWebCore({ [STATUS]: { body: { firstRunSetupRequired: true } }, [SETUP]: session() });
    const v = await mountGate();
    expect(fieldByLabel(v.container, 'Setup code')).toBeNull();
    typeInto(fieldByLabel(v.container, 'Password'), 'correct-horse-1');
    typeInto(fieldByLabel(v.container, 'Repeat the password'), 'correct-horse-1');
    await click(buttonByText(v.container, 'Create and sign in'));
    expect(core.calls.find((c) => c.rpc === SETUP)?.body).toEqual({ username: 'admin', password: 'correct-horse-1' });
  });

  it('неверный код → понятное сообщение, форма остаётся', async () => {
    stubWebCore({
      [STATUS]: { body: { firstRunSetupRequired: true, setupCodeRequired: true } },
      [SETUP]: failure(403, 'permission_denied'),
    });
    const v = await mountGate();
    typeInto(fieldByLabel(v.container, 'Password'), 'correct-horse-1');
    typeInto(fieldByLabel(v.container, 'Repeat the password'), 'correct-horse-1');
    typeInto(fieldByLabel(v.container, 'Setup code'), 'WRONG');
    await click(buttonByText(v.container, 'Create and sign in'));
    expect(alertText(v.container)).toBe('The setup code is wrong');
    expect(heading(v.container)).toBe('First-time setup');
  });
});
