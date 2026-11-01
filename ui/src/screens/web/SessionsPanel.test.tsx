// SPDX-License-Identifier: GPL-3.0-only

// SessionsPanel.test.tsx — панель сессий: список, отзыв, смена пароля, ошибки.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { CoreContext } from '../../hooks/useCore';
import { createCoreClients } from '../../lib/core';
import { setLanguage } from '../../lib/i18n';
import { setCsrfToken } from '../../lib/webSession';
import { click, mountBare, unmountAll, type Mounted } from '../../test-utils/coreStub';
import { buttonByText, failure, fieldByLabel, stubWebCore, typeInto } from '../../test-utils/webKit';
import { SessionsPanel } from './SessionsPanel';
import { WebSessionContext } from './WebSessionContext';

const LIST = 'WebSessionService/ListSessions';
const NOW = 1_800_000_000_000;

const sess = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  sessionId: id,
  username: 'admin',
  createdAtMs: String(NOW - 5000),
  expiresAtMs: String(NOW + 1e6),
  lastSeenMs: String(NOW),
  clientLabel: 'Firefox',
  remoteAddr: '192.168.1.50',
  ...over,
});

beforeEach(() => {
  setLanguage('en');
  setCsrfToken('csrf-9');
});
afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
  setCsrfToken('');
});

const logout = vi.fn(() => Promise.resolve());
const mountPanel = (withGate = true): Promise<Mounted> =>
  mountBare(
    createElement(
      CoreContext.Provider,
      { value: createCoreClients('http://localhost:3000', { mode: 'cookie', csrf: () => 'csrf-9' }) },
      createElement(
        WebSessionContext.Provider,
        { value: withGate ? { username: 'admin', logout } : null },
        createElement(SessionsPanel),
      ),
    ),
  );

describe('панель сессий', () => {
  it('sessions_revoke: чужая сессия отзывается, текущую отозвать нельзя, список обновляется', async () => {
    const core = stubWebCore({
      [LIST]: (n) => ({
        body: { sessions: n === 0 ? [sess('cur', { current: true }), sess('other', { clientLabel: 'Chrome (phone)' })] : [sess('cur', { current: true })] },
      }),
    });
    const v = await mountPanel();
    expect(v.container.textContent).toContain('Chrome (phone)');
    expect(v.container.textContent).toContain('This session');
    expect(v.container.textContent).toContain('Address: 192.168.1.50');
    const revokes = Array.from(v.container.querySelectorAll('button')).filter((b) => b.textContent === 'Revoke');
    expect(revokes).toHaveLength(1); // у текущей сессии кнопки нет
    expect(revokes[0]?.getAttribute('aria-label')).toBe('Revoke: Chrome (phone)');

    await click(revokes[0]);
    const call = core.calls.find((c) => c.rpc === 'WebSessionService/RevokeSession');
    expect(call?.body).toEqual({ sessionId: 'other' });
    expect(call?.headers.get('X-Lavray-CSRF')).toBe('csrf-9');
    expect(v.container.textContent).not.toContain('Chrome (phone)');
    expect(core.calls.filter((c) => c.rpc === LIST)).toHaveLength(2);
  });

  it('сессия без метки получает название по умолчанию', async () => {
    stubWebCore({ [LIST]: { body: { sessions: [sess('s1', { clientLabel: undefined, current: true })] } } });
    const v = await mountPanel();
    expect(v.container.textContent).toContain('Unknown device');
  });

  it('ошибка отзыва показывается и не ломает панель', async () => {
    stubWebCore({
      [LIST]: { body: { sessions: [sess('cur', { current: true }), sess('other')] } },
      'WebSessionService/RevokeSession': failure(404, 'not_found'),
    });
    const v = await mountPanel();
    await click(buttonByText(v.container, 'Revoke'));
    expect(v.container.querySelector('[role="alert"]')).not.toBeNull();
    expect(v.container.textContent).toContain('Firefox');
  });

  it('кнопка выхода вызывает logout шлюза', async () => {
    stubWebCore({ [LIST]: { body: { sessions: [] } } });
    const v = await mountPanel();
    await click(buttonByText(v.container, 'Sign out'));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('вне ворот (оболочка) панели нет и запросов не делается', async () => {
    const core = stubWebCore({});
    const v = await mountPanel(false);
    expect(v.container.querySelector('#webSessions')).toBeNull();
    expect(core.calls).toHaveLength(0);
  });
});

describe('смена пароля', () => {
  const fill = (c: HTMLElement, oldPw: string, newPw: string): void => {
    typeInto(fieldByLabel(c, 'Current password'), oldPw);
    typeInto(fieldByLabel(c, 'New password'), newPw);
  };

  it('успех: ядро получает оба пароля, пользователь видит число отозванных сессий, поля очищены', async () => {
    const core = stubWebCore({
      [LIST]: { body: { sessions: [] } },
      'WebSessionService/ChangePassword': { body: { revokedOtherSessions: 3 } },
    });
    const v = await mountPanel();
    fill(v.container, 'correct-horse-1', 'brand-new-pass-1');
    await click(buttonByText(v.container, 'Change password'));
    expect(core.calls.find((c) => c.rpc === 'WebSessionService/ChangePassword')?.body).toEqual({
      oldPassword: 'correct-horse-1',
      newPassword: 'brand-new-pass-1',
    });
    expect(v.container.textContent).toContain('Password changed. Other sessions signed out: 3');
    expect(fieldByLabel(v.container, 'New password')?.value).toBe('');
  });

  it('короткий новый пароль не уходит в ядро', async () => {
    const core = stubWebCore({ [LIST]: { body: { sessions: [] } } });
    const v = await mountPanel();
    fill(v.container, 'correct-horse-1', 'short');
    await click(buttonByText(v.container, 'Change password'));
    expect(v.container.querySelector('[role="alert"]')?.textContent).toBe('The password must be at least 10 characters');
    expect(core.calls.some((c) => c.rpc === 'WebSessionService/ChangePassword')).toBe(false);
  });

  it('неверный текущий пароль → понятное сообщение', async () => {
    stubWebCore({
      [LIST]: { body: { sessions: [] } },
      'WebSessionService/ChangePassword': failure(400, 'invalid_argument'),
    });
    const v = await mountPanel();
    fill(v.container, 'wrong-password-1', 'brand-new-pass-1');
    await click(buttonByText(v.container, 'Change password'));
    expect(v.container.querySelector('[role="alert"]')?.textContent).toBe('The current password is wrong');
  });
});
