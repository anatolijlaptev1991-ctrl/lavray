// SPDX-License-Identifier: GPL-3.0-only

// playwright.config.ts — web-e2e (T-76, job CI `web-e2e`): ядро запускается
// скриптом e2e/start-core.sh с --web-bind на loopback и встроенным ui/dist.
import { defineConfig } from '@playwright/test';

const port = process.env.LAVRAY_E2E_PORT ?? '8787';

export default defineConfig({
  testDir: 'e2e',
  // Сценарии идут по порядку на одном ядре: первый создаёт администратора.
  fullyParallel: false,
  workers: 1,
  retries: 0, // повтор не годится: первый сценарий создаёт администратора
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'bash e2e/start-core.sh',
    url: `http://127.0.0.1:${port}/healthz`,
    timeout: 60_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
