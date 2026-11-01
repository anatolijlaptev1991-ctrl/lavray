// SPDX-License-Identifier: GPL-3.0-only

// LastCheckedLine.test.tsx — строка «Последняя проверка: N дней назад» (T-75):
// не показывается до первой проверки, склоняется по правилам языка (ru: 1 день,
// 2 дня, 5 дней, 11, 21, 22), с 7-х суток предупреждает, с 30-х — красная пометка.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { setLanguage, type Language } from '../../lib/i18n';
import { mountBare, unmountAll } from '../../test-utils/coreStub';
import { LastCheckedLine } from './LastCheckedLine';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);

async function line(days: number | null, lang: Language): Promise<HTMLElement | null> {
  setLanguage(lang);
  const last = days === null ? 0 : NOW - days * DAY;
  const { container } = await mountBare(createElement(LastCheckedLine, { lastCheckedAtMs: last, nowMs: NOW }));
  return container.querySelector<HTMLElement>('#updLastCheck');
}

beforeEach(() => {
  setLanguage('en');
});
afterEach(() => {
  unmountAll();
  setLanguage('en');
});

describe('LastCheckedLine', () => {
  it('до первой проверки (0) — ничего не рисуется', async () => {
    expect(await line(null, 'ru')).toBeNull();
  });

  it('сегодня — «сегодня», без предупреждений', async () => {
    const el = await line(0, 'ru');
    expect(el?.textContent).toBe('Последняя проверка: сегодня');
    expect(el?.getAttribute('data-fresh')).toBe('ok');
    expect(el?.querySelector('.badge')).toBeNull();
  });

  it.each([
    [1, 'Последняя проверка: 1 день назад'],
    [2, 'Последняя проверка: 2 дня назад'],
    [5, 'Последняя проверка: 5 дней назад'],
    [6, 'Последняя проверка: 6 дней назад'],
  ])('ru: %i суток — склонение «%s»', async (days, expected) => {
    expect((await line(days, 'ru'))?.textContent).toBe(expected);
  });

  it.each([
    [11, '11 дней'],
    [21, '21 день'],
    [22, '22 дня'],
  ])('ru: %i суток склоняется как «%s» (с предупреждением)', async (days, form) => {
    const el = await line(days, 'ru');
    expect(el?.textContent).toContain(`${form} назад`);
    expect(el?.getAttribute('data-fresh')).toBe('warn');
  });

  it.each(['en', 'de', 'es', 'zh'] as const)('%s: пять суток отображаются числом', async (lang) => {
    expect((await line(5, lang))?.textContent).toMatch(/5/);
  });

  it('границы 6/7/29/30: ok → warn → warn → red, с текстом пометки', async () => {
    expect((await line(6, 'en'))?.getAttribute('data-fresh')).toBe('ok');
    unmountAll();
    const warn = await line(7, 'en');
    expect(warn?.getAttribute('data-fresh')).toBe('warn');
    expect(warn?.querySelector('.badge-warn')?.textContent).toBe('It’s been a while since the last update check.');
    unmountAll();
    expect((await line(29, 'en'))?.getAttribute('data-fresh')).toBe('warn');
    unmountAll();
    const red = await line(30, 'en');
    expect(red?.getAttribute('data-fresh')).toBe('red');
    expect(red?.querySelector('.badge-err')?.textContent).toBe('Updates haven’t been checked for over 30 days. Check now.');
  });
});
