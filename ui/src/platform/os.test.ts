// SPDX-License-Identifier: GPL-3.0-only

// os.test.ts — T-63: ОС определяется в одном месте (platform/hostOs.ts; adapter.ts его реэкспортирует).
import { describe, expect, it } from 'vitest';
import { detectOS, osAttribute } from './adapter';

const sources = import.meta.glob<string>(
  ['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../gen/**', '!../lib/dictionaries/**'],
  { query: '?raw', import: 'default', eager: true },
);

/** Ключи glob относительны тесту: './adapter.ts' в этом каталоге и '../x/y.ts' в остальных. */
const baseName = (file: string): string => file.replace(/^.*\//, '');

function winWith(userAgent: string): Window {
  return { navigator: { userAgent } } as unknown as Window;
}

describe('определение ОС', () => {
  it('detectOS по User-Agent', () => {
    expect(detectOS(winWith('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124'))).toBe('windows');
    expect(detectOS(winWith('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605'))).toBe('macos');
    expect(detectOS(winWith('Mozilla/5.0 (X11; Linux x86_64) Chrome/124'))).toBe('linux');
    expect(detectOS(winWith('curl/8'))).toBe('web');
  });

  it('osAttribute даёт значение html[data-os] словаря прототипа', () => {
    expect(osAttribute('windows')).toBe('win');
    expect(osAttribute('macos')).toBe('mac');
    expect(osAttribute('linux')).toBe('linux');
    expect(osAttribute('web')).toBe('linux'); // как раньше в main.tsx
  });

  it('navigator.userAgent читает ровно один исходник — platform/hostOs.ts', () => {
    // Поле протокола group.userAgent (UA для запросов подписки) — не определение ОС.
    const readers = Object.entries(sources)
      .filter(([, text]) => /\bnavigator\.userAgent\b/.test(text))
      .map(([file]) => baseName(file));
    expect(readers).toEqual(['hostOs.ts']);
  });

  it('main.tsx берёт data-os из detectOS, а не из своей копии', () => {
    const main = Object.entries(sources).find(([file]) => baseName(file) === 'main.tsx')?.[1] ?? '';
    expect(main).toContain('osAttribute(detectOS(window))');
  });
});
