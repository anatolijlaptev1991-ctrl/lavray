// SPDX-License-Identifier: GPL-3.0-only

// D-3: экран выбирается по разделу и вкладке одной функцией для App и для
// предзагрузки; каждая вкладка из SECTIONS должна открывать свой экран.
import { describe, expect, it } from 'vitest';
import { preloadRoute, screenIdOf } from './lazyViews';
import { SECTIONS } from './sections';

describe('screenIdOf', () => {
  it('каждая вкладка каждого раздела открывает экран, и экраны не повторяются', () => {
    const ids = SECTIONS.flatMap((s) => s.tabs.map((tab) => screenIdOf(s.id, tab.id)));
    expect(ids).not.toContain(null);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('вкладка по умолчанию (не найдена или не задана) — первый экран раздела', () => {
    expect(screenIdOf('servers', undefined)).toBe('servers');
    expect(screenIdOf('rules', 'нет-такой')).toBe('rules');
    expect(screenIdOf('diag', undefined)).toBe('checks');
    expect(screenIdOf('settings', '')).toBe('settings');
  });

  it('неизвестный раздел — без экрана', () => {
    expect(screenIdOf('нет-такого', 'x')).toBeNull();
  });
});

describe('preloadRoute', () => {
  it('не бросает ни для известного, ни для неизвестного раздела', () => {
    expect(() => {
      preloadRoute('connection', '');
      preloadRoute('нет-такого', '');
    }).not.toThrow();
  });
});
