// SPDX-License-Identifier: GPL-3.0-only

// build-config.test.ts — T-62: релизная сборка не публикует карты исходников.
// Конфиг читается как текст: импорт vite.config.ts в среде jsdom падает
// внутри esbuild («TextEncoder … instanceof Uint8Array»).
import { describe, expect, it } from 'vitest';
import configSource from '../vite.config.ts?raw';

describe('vite.config.ts', () => {
  it('sourcemap выключен: карты исходников не попадают в установщик (A2-25)', () => {
    const code = configSource.replace(/\/\/[^\n]*/g, ''); // без комментариев
    expect(code).toMatch(/sourcemap:\s*false/);
    expect(code).not.toMatch(/sourcemap:\s*(true|'(inline|hidden)')/);
  });
});
