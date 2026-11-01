// SPDX-License-Identifier: GPL-3.0-only

// App.hotkeys.test.tsx — T-63: горячие клавиши на любой раскладке, подписи
// сочетаний с модификатором, Ctrl+K фокусирует поиск, подсказки у иконок рельса.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { warmViews } from './test-harness';
import App from './App';
import { setLanguage } from './lib/i18n';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15';

async function flush(ms = 120): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  });
}

async function mount(): Promise<HTMLDivElement> {
  const el = document.createElement('div');
  document.body.append(el);
  host = el;
  root = createRoot(el);
  act(() => {
    root?.render(createElement(App));
  });
  await flush(40);
  return el;
}

async function press(init: KeyboardEventInit): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    await Promise.resolve();
  });
  await flush();
}

const title = (): string => document.querySelector('#ghTitle')?.textContent ?? '';

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
  window.localStorage.clear();
  window.localStorage.setItem('lavray.onboarded', '1');
  window.localStorage.setItem('lavray.lang', 'ru');
  window.location.hash = 'screen=connection';
  setLanguage('ru');
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
  delete (navigator as unknown as { userAgent?: string }).userAgent;
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true });
  setLanguage('en');
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

beforeAll(warmViews, 60_000);

describe('T-63: горячие клавиши на русской раскладке (ЙЦУКЕН)', () => {
  it('Ctrl+К (физическая K) открывает «Серверы» и ставит фокус в поиск', async () => {
    await mount();
    expect(title()).toBe('Подключение');
    await press({ key: 'л', code: 'KeyK', ctrlKey: true });
    expect(title()).toBe('Серверы');
    const search = document.querySelector<HTMLInputElement>('#profSearch');
    expect(search, 'поле поиска серверов').not.toBeNull();
    expect(document.activeElement).toBe(search);
  });

  it('Ctrl+K на латинской раскладке тоже фокусирует поиск, повторное нажатие не ломает фокус', async () => {
    await mount();
    await press({ key: 'k', code: 'KeyK', ctrlKey: true });
    expect(document.activeElement?.id).toBe('profSearch');
    await press({ key: 'k', code: 'KeyK', ctrlKey: true });
    expect(document.activeElement?.id).toBe('profSearch');
  });

  it('Ctrl+Б (физическая запятая) открывает «Настройки»', async () => {
    await mount();
    await press({ key: 'б', code: 'Comma', ctrlKey: true });
    expect(title()).toBe('Настройки');
  });

  it('на macOS вместо Ctrl работает ⌘, а Ctrl не срабатывает', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: MAC_UA, configurable: true });
    await mount();
    await press({ key: 'л', code: 'KeyK', ctrlKey: true });
    expect(title()).toBe('Подключение');
    await press({ key: 'л', code: 'KeyK', metaKey: true });
    expect(title()).toBe('Серверы');
  });
});

describe('T-63: подписи сочетаний', () => {
  async function hotkeyRows(): Promise<string[]> {
    await mount();
    await press({ key: '?', shiftKey: true });
    return Array.from(document.querySelectorAll('.hk-row .kbd')).map((k) => k.textContent ?? '');
  }

  it('диалог «Горячие клавиши»: Ctrl+K, Ctrl+D, Esc, Ctrl+,', async () => {
    expect(await hotkeyRows()).toEqual(['Ctrl+K', 'Ctrl+D', 'Esc', 'Ctrl+,']);
  });

  it('немецкий интерфейс: Strg вместо Ctrl', async () => {
    window.localStorage.setItem('lavray.lang', 'de');
    setLanguage('de');
    expect(await hotkeyRows()).toEqual(['Strg+K', 'Strg+D', 'Esc', 'Strg+,']);
  });

  it('macOS: ⌘K, ⌘D, Esc, ⌘,', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: MAC_UA, configurable: true });
    expect(await hotkeyRows()).toEqual(['⌘K', '⌘D', 'Esc', '⌘,']);
  });

  it('поле поиска серверов подписано тем же сочетанием', async () => {
    await mount();
    await press({ key: '2', code: 'Digit2', ctrlKey: true });
    expect(document.querySelector('.searchwrap .kbd')?.textContent).toBe('Ctrl+K');
  });
});

describe('T-63: каркас', () => {
  it('рельс (600–959 px): у иконок разделов есть подсказки с названиями', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true, writable: true });
    await mount();
    const items = Array.from(document.querySelectorAll<HTMLElement>('.sb-item'));
    expect(items).toHaveLength(5);
    expect(items.map((b) => b.title)).toEqual(['Подключение', 'Серверы', 'Правила', 'Диагностика', 'Настройки']);
  });

  it('широкое окно: подписи видны, дублирующих подсказок нет', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
    await mount();
    const items = Array.from(document.querySelectorAll<HTMLElement>('.sb-item'));
    expect(items.map((b) => b.getAttribute('title'))).toEqual([null, null, null, null, null]);
  });

  it('логотип сайдбара вне порядка Tab, но по клику открывает «Подключение»', async () => {
    window.location.hash = 'screen=settings';
    await mount();
    const logo = document.querySelector<HTMLButtonElement>('.sb-logo');
    expect(logo?.tabIndex).toBe(-1);
    await act(async () => {
      logo?.click();
      await Promise.resolve();
    });
    expect(title()).toBe('Подключение');
  });
});
