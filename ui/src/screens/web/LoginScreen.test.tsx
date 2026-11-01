// SPDX-License-Identifier: GPL-3.0-only

// LoginScreen.test.tsx — экран входа: отправка пароля, подписи и ошибки для
// скринридера (VC, A).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { setLanguage } from '../../lib/i18n';
import { click, flush, mountBare, unmountAll, type Mounted } from '../../test-utils/coreStub';
import { buttonByText, fieldByLabel, typeInto } from '../../test-utils/webKit';
import { LoginScreen } from './LoginScreen';

beforeEach(() => {
  setLanguage('en');
});
afterEach(() => {
  unmountAll();
});

const mountLogin = (
  over: Partial<Parameters<typeof LoginScreen>[0]> = {},
): { onSubmit: ReturnType<typeof vi.fn>; view: Promise<Mounted> } => {
  const onSubmit = vi.fn();
  const view = mountBare(
    createElement(LoginScreen, { busy: false, message: null, lockedUntil: null, onSubmit, ...over }),
  );
  return { onSubmit, view };
};

describe('экран входа', () => {
  it('login_screen_submits_password: имя и пароль уходят в onSubmit, поле пароля очищается', async () => {
    const { onSubmit, view } = mountLogin();
    const v = await view;
    typeInto(fieldByLabel(v.container, 'Username'), 'admin');
    const pw = fieldByLabel(v.container, 'Password');
    typeInto(pw, 'correct-horse-1');
    await click(buttonByText(v.container, 'Sign in'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('admin', 'correct-horse-1');
    expect(pw?.value).toBe(''); // пароль не остаётся в поле после отправки
    expect(pw?.type).toBe('password');
    expect(pw?.autocomplete).toBe('current-password');
  });

  it('Enter в поле отправляет форму', async () => {
    const { onSubmit, view } = mountLogin();
    const v = await view;
    typeInto(fieldByLabel(v.container, 'Username'), 'admin');
    typeInto(fieldByLabel(v.container, 'Password'), 'x');
    await act(async () => {
      v.container.querySelector('form')?.requestSubmit();
      await Promise.resolve();
    });
    expect(onSubmit).toHaveBeenCalledWith('admin', 'x');
  });

  it('login_form_labels_and_errors_announced: подписи связаны с полями, ошибка — role=alert', async () => {
    const { view } = mountLogin({ message: { key: 'web.login.badCreds' } });
    const v = await view;
    const form = v.container.querySelector('form');
    const title = v.container.querySelector('h2');
    expect(form?.getAttribute('aria-labelledby')).toBe(title?.id);
    const user = fieldByLabel(v.container, 'Username');
    const pw = fieldByLabel(v.container, 'Password');
    expect(user).not.toBeNull();
    expect(pw).not.toBeNull();
    const alert = v.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('Wrong username or password');
    expect(pw?.getAttribute('aria-describedby')).toBe(alert?.id);
    expect(pw?.getAttribute('aria-invalid')).toBe('true');
    expect(user?.getAttribute('aria-invalid')).toBe('true');
    expect(v.container.querySelectorAll('.field.invalid')).toHaveLength(2);
  });

  it('без ошибки поля не помечены недопустимыми', async () => {
    const { view } = mountLogin();
    const v = await view;
    expect(fieldByLabel(v.container, 'Password')?.getAttribute('aria-invalid')).toBe('false');
    expect(v.container.querySelector('[role="alert"]')?.textContent).toBe('');
  });

  it('блокировка лимитером: кнопка недоступна до конца паузы, затем включается сама', async () => {
    const { view } = mountLogin({
      lockedUntil: Date.now() + 1500,
      message: { key: 'web.login.wait', params: { n: 1 } },
    });
    const v = await view;
    expect(buttonByText(v.container, 'Sign in')?.disabled).toBe(true);
    expect(v.container.querySelector('[role="alert"]')?.textContent).toBe('Too many sign-in attempts. Try again in 1 s');
    await flush(1800);
    expect(buttonByText(v.container, 'Sign in')?.disabled).toBe(false);
  });

  it('пока идёт запрос, кнопка недоступна', async () => {
    const { view } = mountLogin({ busy: true });
    const v = await view;
    expect(buttonByText(v.container, 'Sign in')?.disabled).toBe(true);
  });

  it('тексты берутся из словаря языка интерфейса (ru)', async () => {
    setLanguage('ru');
    const { view } = mountLogin();
    const v = await view;
    expect(fieldByLabel(v.container, 'Имя пользователя')).not.toBeNull();
    expect(fieldByLabel(v.container, 'Пароль')).not.toBeNull();
    expect(buttonByText(v.container, 'Войти')).not.toBeNull();
  });
});
