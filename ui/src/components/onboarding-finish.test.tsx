// onboarding-finish.test.tsx — T-73 (F-108, B1-26, D1-06): мастер заканчивается
// кнопкой «Готово» (не «Далее»), выбранные режимы сохраняются, «Перенести из
// NekoBox» — настоящая кнопка со статусом «Скоро» и без нераскрытых {servers}.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import App from '../App';
import { CoreContext } from '../hooks/useCore';
import { createCoreClients } from '../lib/core';
import { loadModes } from '../lib/connection';
import { setLanguage, t } from '../lib/i18n';
import { OnboardingDialog } from './dialogs';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function setActEnvironment(on: boolean): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = on;
}

function dialog(): HTMLElement {
  const dlg = document.querySelector<HTMLElement>('[role="dialog"]');
  if (dlg === null) throw new Error('мастер не открыт');
  return dlg;
}

function footerButton(label: string): HTMLButtonElement | undefined {
  return Array.from(dialog().querySelectorAll<HTMLButtonElement>('.dlg-f button')).find(
    (b) => (b.textContent ?? '').trim() === label,
  );
}

function click(el: Element | null | undefined): void {
  if (!(el instanceof HTMLElement)) throw new Error('элемент для клика не найден');
  act(() => {
    el.click();
  });
}

const NEXT = t('common.next', 'en');
const DONE = t('onb.finish', 'en');
const SKIP = t('onb.skip', 'en');

describe('T-73: онбординг — «Готово», режимы, NekoBox', () => {
  let container: HTMLDivElement;
  let root: Root;
  const clients = createCoreClients('http://127.0.0.1:1');

  beforeEach(() => {
    setActEnvironment(true);
    setLanguage('en');
    window.localStorage.clear();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
    window.localStorage.clear();
    setActEnvironment(false);
    vi.restoreAllMocks();
  });

  function open(onClose = vi.fn(), onOpenImport = vi.fn()): { onClose: typeof onClose; onOpenImport: typeof onOpenImport } {
    const el: ReactElement = (
      <CoreContext.Provider value={clients}>
        <OnboardingDialog onClose={onClose} onOpenImport={onOpenImport} />
      </CoreContext.Provider>
    );
    act(() => {
      root.render(el);
    });
    return { onClose, onOpenImport };
  }

  /** Шаг 1 → шаг n нажатием «Далее». */
  function goToStep(n: number): void {
    for (let step = 1; step < n; step += 1) {
      click(footerButton(NEXT));
    }
  }

  function modeSwitches(): HTMLElement[] {
    return Array.from(dialog().querySelectorAll<HTMLElement>('.onb-mode-row [role="switch"]'));
  }

  describe('последний шаг', () => {
    it('основная кнопка шага 4 называется «Done», а не «Next»', () => {
      open();
      goToStep(4);
      expect(dialog().textContent).toContain(t('onb.doneTitle', 'en'));
      expect(footerButton(DONE), 'кнопка «Готово»').toBeDefined();
      expect(footerButton(NEXT), 'кнопки «Далее» на последнем шаге нет').toBeUndefined();
    });

    it('на шагах 1–3 основная кнопка по-прежнему «Next»', () => {
      open();
      for (const step of [1, 2, 3]) {
        expect(footerButton(NEXT), `шаг ${String(step)}`).toBeDefined();
        click(footerButton(NEXT));
      }
    });

    it('«Done» закрывает мастер', () => {
      const { onClose } = open();
      goToStep(4);
      click(footerButton(DONE));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('режимы', () => {
    it('выбор на шаге 3 сохраняется в lavray.modes при «Done»', () => {
      open();
      goToStep(3);
      const [sys, tun] = modeSwitches();
      expect(sys?.getAttribute('aria-checked')).toBe('true'); // по умолчанию
      expect(tun?.getAttribute('aria-checked')).toBe('false');
      click(tun); // включили TUN, системный прокси остался
      click(sys); // и выключили системный прокси
      click(footerButton(NEXT));
      click(footerButton(DONE));
      expect(JSON.parse(window.localStorage.getItem('lavray.modes') ?? 'null')).toEqual({
        sysProxy: false,
        tunMode: true,
      });
    });

    it('оба режима можно сохранить одновременно', () => {
      open();
      goToStep(3);
      click(modeSwitches()[1]);
      click(footerButton(NEXT));
      click(footerButton(DONE));
      expect(loadModes(window.localStorage)).toEqual({ sysProxy: true, tunMode: true });
    });

    it('«Skip» и Esc режимы не трогают', () => {
      const { onClose } = open();
      goToStep(3);
      click(modeSwitches()[1]);
      click(footerButton(SKIP));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem('lavray.modes')).toBeNull();
    });

    it('при повторном открытии переключатели показывают сохранённые режимы', () => {
      window.localStorage.setItem('lavray.modes', JSON.stringify({ sysProxy: false, tunMode: true }));
      open();
      goToStep(3);
      const [sys, tun] = modeSwitches();
      expect(sys?.getAttribute('aria-checked')).toBe('false');
      expect(tun?.getAttribute('aria-checked')).toBe('true');
      click(footerButton(NEXT));
      click(footerButton(DONE)); // ничего не меняли — режимы остаются теми же
      expect(loadModes(window.localStorage)).toEqual({ sysProxy: false, tunMode: true });
    });
  });

  describe('«Перенести из NekoBox»', () => {
    function nekoTile(): HTMLElement {
      const label = Array.from(dialog().querySelectorAll<HTMLElement>('.onb-src')).find((e) =>
        (e.textContent ?? '').includes(t('onb.src.neko', 'en')),
      );
      if (label === undefined) throw new Error('плитки NekoBox нет');
      return label;
    }

    it('это кнопка (не span) со статусом «Soon», недоступная для действий', () => {
      open();
      goToStep(2);
      const tile = nekoTile();
      expect(tile.tagName).toBe('BUTTON');
      expect(tile.getAttribute('aria-disabled')).toBe('true');
      expect(tile.textContent).toContain(t('onb.neko.soon', 'en'));
    });

    it('подсказка и текст не содержат нераскрытых {servers}/{subs}', () => {
      open();
      goToStep(2);
      const tile = nekoTile();
      expect(tile.getAttribute('title')).toBe(t('onb.neko.soonHint', 'en'));
      // ни в одном title/aria-label мастера нет шаблонных скобок {…}
      const withText = Array.from(dialog().querySelectorAll<HTMLElement>('[title],[aria-label]'));
      for (const el of withText) {
        const text = `${el.getAttribute('title') ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
        expect(text, el.outerHTML.slice(0, 80)).not.toMatch(/\{\w+\}/);
      }
      expect(dialog().textContent).not.toMatch(/\{\w+\}/);
    });

    it('клик объясняет, что функции пока нет, и ничего не запускает', () => {
      const { onClose, onOpenImport } = open();
      goToStep(2);
      expect(dialog().querySelector('[role="status"]')).toBeNull();
      click(nekoTile());
      expect(dialog().querySelector('[role="status"]')?.textContent).toBe(t('onb.neko.soonHint', 'en'));
      expect(onOpenImport).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('остальные источники работают как раньше', () => {
      const { onClose, onOpenImport } = open();
      goToStep(2);
      const v2ray = Array.from(dialog().querySelectorAll<HTMLElement>('.onb-src')).find((e) =>
        (e.textContent ?? '').includes('v2rayN'),
      );
      click(v2ray);
      expect(onOpenImport).toHaveBeenCalledWith('file');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('App: после мастера экран «Подключение» и статус-бар видят выбранные режимы', () => {
    it('чип TUN появляется сразу, экран «Подключение» пересоздан', async () => {
      vi.spyOn(window, 'matchMedia').mockImplementation(
        (query: string) =>
          ({
            matches: query === '(prefers-color-scheme: dark)',
            media: query,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
          }) as unknown as MediaQueryList,
      );
      Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true });
      window.history.replaceState({}, '', '/?lang=en'); // без onboarded=1 — мастер откроется
      window.location.hash = '#screen=connection';
      await act(async () => {
        root.render(
          <StrictMode>
            <App />
          </StrictMode>,
        );
        await sleep(50);
      });
      expect(document.querySelector('#onbTitle'), 'мастер открыт при первом запуске').not.toBeNull();
      const screenBefore = document.querySelector('#connState');
      expect(screenBefore).not.toBeNull();
      expect(document.querySelector('.st-chip')?.textContent ?? '').not.toContain('TUN');

      goToStep(3);
      click(modeSwitches()[1]);
      click(footerButton(NEXT));
      await act(async () => {
        footerButton(DONE)?.click();
        await sleep(10);
      });

      expect(document.querySelector('#onbTitle'), 'мастер закрыт').toBeNull();
      expect(document.querySelector('.st-chip')?.textContent ?? '', 'чип TUN в статус-баре').toContain('TUN');
      expect(document.querySelector('#connState'), 'экран перечитал режимы (пересоздан)').not.toBe(screenBefore);
      expect(loadModes(window.localStorage).tunMode).toBe(true);
    });
  });
});
