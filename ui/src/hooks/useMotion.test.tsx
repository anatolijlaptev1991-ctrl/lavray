// SPDX-License-Identifier: GPL-3.0-only

// useMotion.test.tsx — настройка «Анимации»: режимы меняют html[data-motion],
// дрейф фона (html[data-input]) замирает через 20 с без ввода и возобновляется
// при вводе, при reduce-motion по умолчанию «Выключены», явный выбор важнее.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { setLanguage } from '../lib/i18n';
import { MotionRow } from '../components/settings/MotionRow';
import { chooseMotion, MOTION_IDLE_MS, MOTION_KEY, resolveMotion } from '../lib/motion';
import { UI_STATE_KEYS } from '../lib/uiState';
import { useMotion } from './useMotion';

let reduce = false;
const mqlListeners = new Set<() => void>();

function stubMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: query === '(prefers-reduced-motion: reduce)' ? reduce : false,
        media: query,
        addEventListener: (_: string, l: () => void) => mqlListeners.add(l),
        removeEventListener: (_: string, l: () => void) => mqlListeners.delete(l),
      }) as unknown as MediaQueryList,
  });
}

function Probe(): null {
  useMotion();
  return null;
}

const attr = (n: 'motion' | 'input'): string | undefined => document.documentElement.dataset[n];
const html = document.documentElement;
let root: Root;
let host: HTMLDivElement;

async function mount(el: ReturnType<typeof createElement>): Promise<void> {
  await act(async () => {
    root.render(el);
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  reduce = false;
  mqlListeners.clear();
  stubMatchMedia();
  window.localStorage.clear();
  setLanguage('en');
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
  delete html.dataset.motion;
  delete html.dataset.input;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

describe('настройка «Анимации»', () => {
  it('по умолчанию «Полные»; ключ синхронизируется с оболочкой (ui-state.json)', async () => {
    await mount(createElement(Probe));
    expect(attr('motion')).toBe('full');
    expect(window.localStorage.getItem(MOTION_KEY)).toBeNull(); // умолчание не записывается
    expect(UI_STATE_KEYS).toContain('lavray.motion');
  });

  it('переключение режимов сразу меняет атрибут и сохраняется', async () => {
    await mount(createElement(Probe));
    act(() => {
      chooseMotion(window, 'lite');
    });
    expect(attr('motion')).toBe('lite');
    expect(window.localStorage.getItem(MOTION_KEY)).toBe('lite');
    act(() => {
      chooseMotion(window, 'off');
    });
    expect(attr('motion')).toBe('off');
    act(() => {
      chooseMotion(window, 'full');
    });
    expect(attr('motion')).toBe('full');
  });

  it('при системном reduce-motion по умолчанию «Выключены», явный выбор важнее', async () => {
    reduce = true;
    await mount(createElement(Probe));
    expect(attr('motion')).toBe('off');
    expect(attr('input')).toBeUndefined();
    act(() => {
      chooseMotion(window, 'full');
    });
    expect(attr('motion')).toBe('full');
    expect(attr('input')).toBe('1');
    expect(resolveMotion(window.localStorage, window)).toBe('full'); // и после перезапуска
  });

  it('смена системного reduce-motion без явного выбора применяется на лету', async () => {
    await mount(createElement(Probe));
    expect(attr('motion')).toBe('full');
    reduce = true;
    act(() => {
      mqlListeners.forEach((l) => {
        l();
      });
    });
    expect(attr('motion')).toBe('off');
  });

  it('сохранённый выбор читается при старте; мусор в хранилище игнорируется', async () => {
    window.localStorage.setItem(MOTION_KEY, 'lite');
    await mount(createElement(Probe));
    expect(attr('motion')).toBe('lite');
    act(() => {
      root.unmount();
    });
    root = createRoot(host);
    window.localStorage.setItem(MOTION_KEY, 'turbo');
    await mount(createElement(Probe));
    expect(attr('motion')).toBe('full');
  });

  it('дрейф: через 20 с без ввода признак пропадает, ввод возвращает его и продлевает на 20 с', async () => {
    await mount(createElement(Probe));
    expect(attr('input')).toBe('1');
    act(() => {
      vi.advanceTimersByTime(MOTION_IDLE_MS - 1);
    });
    expect(attr('input')).toBe('1');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(attr('input')).toBeUndefined();

    act(() => {
      window.dispatchEvent(new Event('pointermove'));
    });
    expect(attr('input')).toBe('1');
    act(() => {
      vi.advanceTimersByTime(15_000);
      window.dispatchEvent(new Event('keydown')); // ввод в середине окна продлевает его
      vi.advanceTimersByTime(15_000);
    });
    expect(attr('input')).toBe('1');
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(attr('input')).toBeUndefined();
  });

  it('колесо, нажатие и фокус тоже считаются вводом', async () => {
    await mount(createElement(Probe));
    for (const name of ['wheel', 'pointerdown', 'focus']) {
      act(() => {
        vi.advanceTimersByTime(MOTION_IDLE_MS);
      });
      expect(attr('input')).toBeUndefined();
      act(() => {
        window.dispatchEvent(new Event(name));
      });
      expect(attr('input'), name).toBe('1');
    }
  });

  it('в «Экономных» и «Выключены» слежения за вводом и таймера нет', async () => {
    const idleTimers = vi.spyOn(window, 'setTimeout');
    const armed = (): number => idleTimers.mock.calls.filter(([, ms]) => ms === MOTION_IDLE_MS).length;
    window.localStorage.setItem(MOTION_KEY, 'lite');
    await mount(createElement(Probe));
    expect(attr('input')).toBeUndefined();
    expect(armed()).toBe(0);
    act(() => {
      chooseMotion(window, 'full');
    });
    expect(armed()).toBe(1);
    act(() => {
      chooseMotion(window, 'off');
    });
    expect(attr('input')).toBeUndefined();
    act(() => {
      window.dispatchEvent(new Event('pointermove')); // в «Выключены» ввод ни на что не влияет
    });
    expect(attr('input')).toBeUndefined();
    expect(armed()).toBe(1);
  });

  it('размонтирование снимает атрибуты и слушатели', async () => {
    await mount(createElement(Probe));
    act(() => {
      root.unmount();
    });
    expect(attr('motion')).toBeUndefined();
    expect(attr('input')).toBeUndefined();
    act(() => {
      vi.advanceTimersByTime(MOTION_IDLE_MS);
    });
    expect(attr('input')).toBeUndefined();
    root = createRoot(host);
  });
});

describe('строка «Анимации» в настройках', () => {
  it('три варианта на языке интерфейса; клик применяет режим сразу и запоминает', async () => {
    await mount(createElement('div', null, createElement(Probe), createElement(MotionRow)));
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('#motionRow .seg button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Full', 'Lite', 'Off']);
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true');
    act(() => {
      buttons[1]?.click();
    });
    expect(attr('motion')).toBe('lite');
    expect(window.localStorage.getItem(MOTION_KEY)).toBe('lite');
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('true');
    act(() => {
      setLanguage('ru');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect([...host.querySelectorAll('#motionRow .seg button')].map((b) => b.textContent)).toEqual([
      'Полные',
      'Экономные',
      'Выключены',
    ]);
  });
});
