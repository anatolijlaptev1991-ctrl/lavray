// SPDX-License-Identifier: GPL-3.0-only

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    // T-62: карты исходников не должны попадать в установщик.
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // styles.test.ts читает текст prototype.css/base.css (?raw); без этого Vitest отдаёт ''.
    css: { include: [/\/src\/(prototype|base)\.css/] },
  },
});
