// SPDX-License-Identifier: GPL-3.0-only

// web-login.spec.ts — T-76 [PW] web-e2e: настоящий браузер, настоящее ядро с
// --web-bind на loopback и собранный ui/dist. Сценарий: первичная настройка →
// список серверов → выход → повторный вход. Браузеры ставятся только в CI
// (`npx playwright install --with-deps chromium`); локально тест не запускают.
import { expect, test } from '@playwright/test';

const TOKEN = process.env.LAVRAY_E2E_TOKEN ?? 'e2e-core-token-0123456789abcdef0123456789';
const PASSWORD = 'e2e-password-123';
const SERVER_NAME = 'E2E server';

test.beforeEach(async ({ page }) => {
  // Без вводного мастера и с английским интерфейсом: подписи в тесте — английские.
  await page.addInitScript(() => {
    window.localStorage.setItem('lavray.onboarded', '1');
    window.localStorage.setItem('lavray.lang', 'en');
  });
});

test.beforeAll(async ({ request, baseURL }) => {
  // Сервер для списка добавляется по Bearer-токену ядра (headless-путь шлюза).
  const res = await request.post(`${baseURL ?? ''}/lavray.v1.ProfileService/CreateProfile`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
    },
    data: {
      profile: {
        groupId: '2147483000',
        type: 'PROFILE_TYPE_VLESS',
        name: SERVER_NAME,
        address: 'e2e.example.org',
        port: 443,
        trojanVless: { password: 'b831381d-6324-4d53-ad4f-8cda48b30811' },
      },
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
});

test('вход → список серверов → выход', async ({ page }) => {
  await page.goto('/');

  // Первичная настройка: администратора ещё нет.
  await expect(page.getByRole('heading', { name: 'First-time setup' })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat the password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create and sign in' }).click();

  // Приложение открылось; серверы — в разделе «Servers».
  const nav = page.getByRole('navigation').first();
  await nav.getByRole('button', { name: 'Servers' }).click();
  await expect(page.getByText(SERVER_NAME).first()).toBeVisible();

  // Выход: кнопка в «Настройки → Общие».
  await nav.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to LAVRay' })).toBeVisible();

  // После выхода интерфейс закрыт, а повторный вход пускает обратно.
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(nav.getByRole('button', { name: 'Servers' })).toBeVisible();
});

test('неверный пароль не пускает', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to LAVRay' })).toBeVisible();
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Wrong username or password' })).toBeVisible();
});
