// SPDX-License-Identifier: GPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';

/** jsdom lacks matchMedia — install a minimal stub. */
function stubMatchMedia(): void {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    return {
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaQueryList;
  });
}

/** React 18 act() environment flag. */
function setActEnvironment(on: boolean): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = on;
}

describe('App scaffold smoke render', () => {
  let root: Root | null = null;
  let host: HTMLDivElement;

  beforeEach(() => {
    setActEnvironment(true);
    stubMatchMedia();
    // App derives the initial language from the environment (DS §9).
    Object.defineProperty(navigator, 'languages', { value: ['ru-RU'], configurable: true });
    window.localStorage.clear();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-accent');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    vi.restoreAllMocks();
    setActEnvironment(false);
  });

  function renderApp(): void {
    act(() => {
      root?.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });
  }

  it('renders the five sections and the first screen', () => {
    renderApp();

    const buttons = Array.from(document.querySelectorAll<HTMLElement>('.sb-item'));
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Подключение',
      'Серверы',
      'Правила',
      'Диагностика',
      'Настройки',
    ]);
    // Заголовок раздела даёт каркас (#ghTitle прототипа); на экране — только
    // live-регион статуса, дублей заголовка нет.
    expect(document.querySelector('#ghTitle')?.textContent).toBe('Подключение');
    expect(document.querySelector('#connState')).not.toBeNull();
    // При первом запуске показывается онбординг (dlgOnb) со своим h2 —
    // он перекрывает экран до завершения мастера.
    const onb = document.querySelector('#onbTitle');
    expect(onb?.textContent).toContain('LAVRay');
    // Завершаем онбординг и убеждаемся, что экран подключения на месте.
    act(() => {
      window.localStorage.setItem('lavray.onboarded', '1');
      window.dispatchEvent(new Event('hashchange'));
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.accent).toBe('amber');
  });

  it('switches sections via Ctrl+1..5', () => {
    renderApp();

    const press = (key: string): void => {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true }));
      });
    };

    press('3'); // Правила
    const items = Array.from(document.querySelectorAll<HTMLElement>('.sb-item'));
    expect(items[2]?.classList.contains('on')).toBe(true);

    press('5'); // Настройки — боевой экран (.set), заглушек-табов больше нет
    expect(document.querySelector('#ghTitle')?.textContent).toBe('Настройки');
    expect(document.querySelector('[role="radiogroup"][aria-label="Язык интерфейса"]')).not.toBeNull();
  });

  it('gives every brand-mark gradient a unique id (ray stays painted)', () => {
    renderApp();

    // Регрессия: одинаковые id у <linearGradient> в нескольких знаках
    // «Отражение» — невалидный документ; браузер разрешал url(#lavRay) в
    // первый (скрытый в веб-режиме) элемент, и луч не закрашивался.
    const ids = Array.from(document.querySelectorAll('linearGradient')).map(
      (g) => g.getAttribute('id') ?? '',
    );
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);

    // Каждый луч ссылается на собственный существующий градиент.
    for (const beam of Array.from(document.querySelectorAll('.a-beam'))) {
      const ref = (beam as SVGElement).style.stroke;
      // jsdom нормализует url(...) без кавычек, браузер — в кавычках.
      expect(ref).toMatch(/^url\(["']?#?ray/);
      const id = ref.replace(/^url\(["']?#?/, '').replace(/["']?\)$/, '');
      expect(document.getElementById(id)?.tagName.toLowerCase()).toBe('lineargradient');
    }
  });
});
