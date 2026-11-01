// SPDX-License-Identifier: GPL-3.0-only

// D-3: если словарь стартового языка не загрузился, окно не остаётся пустым.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LANGUAGES } from '../lib/i18n';
import { showBootError } from './bootError';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('showBootError', () => {
  it.each(LANGUAGES)('показывает сообщение и «Повторить» на языке %s', (lang) => {
    const root = document.createElement('div');
    document.body.append(root);
    showBootError(root, lang);
    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent ?? '').not.toBe('');
    const retry = root.querySelector('button');
    expect(retry?.textContent ?? '').not.toBe('');
  });

  it('заменяет содержимое контейнера, «Повторить» перезагружает окно', () => {
    const root = document.createElement('div');
    root.innerHTML = '<span>старое</span>';
    document.body.append(root);
    const reload = vi.fn();
    const fake = { reload } as unknown as Location;
    vi.spyOn(window, 'location', 'get').mockReturnValue(fake);
    showBootError(root, 'en');
    expect(root.textContent).not.toContain('старое');
    root.querySelector('button')?.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
