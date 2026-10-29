// SPDX-License-Identifier: GPL-3.0-only

// dialog-a11y.test.tsx — T-40 (F-059, C1-22, C2-04): редактор профиля и
// онбординг работают на DialogShell: фокус внутри диалога при открытии,
// ловушка Tab, Esc, возврат фокуса на кнопку-открывалку. Содержимое форм при
// переносе не потеряно.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { CoreContext } from '../hooks/useCore';
import { createCoreClients } from '../lib/core';
import { setLanguage } from '../lib/i18n';
import { OnboardingDialog } from './dialogs';
import { ProfileEditor } from './ProfileEditor';

function setActEnvironment(on: boolean): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = on;
}

function setNativeValue(el: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function press(key: string, shiftKey = false): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  act(() => {
    document.dispatchEvent(ev);
  });
  return ev;
}

/** Фокусируемые элементы диалога в порядке DOM (тот же селектор, что у ловушки Tab). */
function focusables(dlg: HTMLElement): HTMLElement[] {
  return Array.from(
    dlg.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

function dialog(): HTMLElement {
  const dlg = document.querySelector<HTMLElement>('[role="dialog"]');
  if (dlg === null) throw new Error('диалог не открыт');
  return dlg;
}

describe('T-40: редактор профиля и онбординг на DialogShell', () => {
  let container: HTMLDivElement;
  let root: Root;
  const clients = createCoreClients('http://127.0.0.1:1');

  beforeEach(() => {
    setActEnvironment(true);
    setLanguage('en');
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
    setActEnvironment(false);
    vi.restoreAllMocks();
  });

  function render(el: ReactElement): void {
    act(() => {
      root.render(<CoreContext.Provider value={clients}>{el}</CoreContext.Provider>);
    });
  }

  /** Кнопка-открывалка + диалог, как на экране «Серверы». */
  function Host({ kind, onClose }: { kind: 'editor' | 'onboarding'; onClose?: () => void }): ReactElement {
    const [open, setOpen] = useState(false);
    const close = (): void => {
      onClose?.();
      setOpen(false);
    };
    return (
      <>
        <button
          id="opener"
          onClick={() => {
            setOpen(true);
          }}
        >
          open
        </button>
        {open && kind === 'editor' && (
          <ProfileEditor profile={null} groupId={1n} onClose={close} onSaved={() => undefined} />
        )}
        {open && kind === 'onboarding' && <OnboardingDialog onClose={close} onOpenImport={() => undefined} />}
      </>
    );
  }

  function openFromButton(kind: 'editor' | 'onboarding', onClose?: () => void): HTMLButtonElement {
    render(<Host kind={kind} {...(onClose ? { onClose } : {})} />);
    const opener = document.querySelector<HTMLButtonElement>('#opener');
    if (opener === null) throw new Error('нет кнопки-открывалки');
    act(() => {
      opener.focus();
    });
    act(() => {
      opener.click();
    });
    return opener;
  }

  describe('ProfileEditor', () => {
    it('при открытии фокус внутри диалога — в поле названия, а не на кнопке под диалогом', () => {
      openFromButton('editor');
      const dlg = dialog();
      expect(dlg.contains(document.activeElement)).toBe(true);
      expect(document.activeElement?.tagName).toBe('INPUT');
      // поле названия — первое текстовое поле формы
      expect(document.activeElement).toBe(dlg.querySelector('input.input'));
    });

    it('диалог доступен: role=dialog, aria-modal, имя через aria-labelledby', () => {
      openFromButton('editor');
      const dlg = dialog();
      expect(dlg.getAttribute('aria-modal')).toBe('true');
      const labelId = dlg.getAttribute('aria-labelledby');
      expect(labelId).not.toBeNull();
      expect(document.getElementById(labelId ?? '')?.textContent?.length).toBeGreaterThan(0);
    });

    it('Tab с последнего элемента уходит на первый, Shift+Tab с первого — на последний', () => {
      openFromButton('editor');
      const items = focusables(dialog());
      const first = items[0];
      const last = items[items.length - 1];
      expect(first).toBeDefined();
      expect(last).toBeDefined();
      if (!first || !last) return;

      act(() => {
        last.focus();
      });
      expect(press('Tab').defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(first);

      expect(press('Tab', true).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(last);
    });

    it('сорок нажатий Tab не выводят фокус из диалога (имитация перехода браузера)', () => {
      openFromButton('editor');
      const dlg = dialog();
      for (let i = 0; i < 40; i += 1) {
        const items = focusables(dlg);
        const idx = items.indexOf(document.activeElement as HTMLElement);
        const ev = press('Tab');
        if (!ev.defaultPrevented) {
          // браузер сам перешёл бы на следующий элемент внутри диалога
          items[(idx + 1) % items.length]?.focus();
        }
        expect(dlg.contains(document.activeElement), `Tab №${String(i + 1)}`).toBe(true);
      }
    });

    it('если фокус оказался вне диалога, Tab возвращает его на первый элемент', () => {
      const opener = openFromButton('editor');
      act(() => {
        opener.focus(); // фокус на кнопке под диалогом
      });
      expect(dialog().contains(document.activeElement)).toBe(false);
      press('Tab');
      expect(document.activeElement).toBe(focusables(dialog())[0]);
    });

    it('Esc закрывает редактор и вызывает onClose один раз', () => {
      const onClose = vi.fn();
      openFromButton('editor', onClose);
      press('Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('после закрытия фокус возвращается на кнопку-открывалку', () => {
      const opener = openFromButton('editor');
      press('Escape');
      expect(document.activeElement).toBe(opener);
    });

    it('клик по затемнению редактор не закрывает и введённое не теряется', () => {
      const onClose = vi.fn();
      openFromButton('editor', onClose);
      const name = dialog().querySelector<HTMLInputElement>('input.input');
      act(() => {
        if (name) setNativeValue(name, 'Draft server');
      });
      const backdrop = document.querySelector<HTMLElement>('.dlg-back');
      act(() => {
        backdrop?.click();
      });
      expect(onClose).not.toHaveBeenCalled();
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(dialog().querySelector<HTMLInputElement>('input.input')?.value).toBe('Draft server');
    });

    it('содержимое формы на месте: тип, название, адрес, порт, заметки, «Отмена», «Сохранить»', () => {
      openFromButton('editor');
      const dlg = dialog();
      const main = dlg.querySelector('.form-grid'); // первая сетка: тип, название, адрес, порт
      // T-66: тип выбирается плитками (radiogroup), а не select; плитки — вне первой сетки.
      expect(dlg.querySelectorAll('[role="radio"]').length).toBeGreaterThan(0);
      expect(main?.querySelectorAll('input')).toHaveLength(3);
      expect(dlg.querySelector('textarea')).not.toBeNull();
      const footer = Array.from(dlg.querySelectorAll('.dlg-f button')).map((b) => b.textContent);
      expect(footer).toHaveLength(2);
    });

    it('«Сохранить» с пустыми полями показывает ошибку в диалоге, а не закрывает его', () => {
      openFromButton('editor');
      act(() => {
        dialog().querySelector<HTMLButtonElement>('.dlg-f .btn-pri')?.click();
      });
      expect(dialog().querySelector('[role="alert"]')).not.toBeNull();
    });
  });

  describe('OnboardingDialog', () => {
    it('при открытии фокус внутри диалога', () => {
      openFromButton('onboarding');
      expect(dialog().contains(document.activeElement)).toBe(true);
    });

    it('Esc закрывает мастер (= «Пропустить») и возвращает фокус на кнопку-открывалку', () => {
      const onClose = vi.fn();
      const opener = openFromButton('onboarding', onClose);
      press('Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(opener);
    });

    it('Tab не выводит фокус за пределы мастера', () => {
      openFromButton('onboarding');
      const items = focusables(dialog());
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) throw new Error('в мастере нет фокусируемых элементов');
      act(() => {
        last.focus();
      });
      press('Tab');
      expect(document.activeElement).toBe(first);
      press('Tab', true);
      expect(document.activeElement).toBe(last);
    });

    it('клик по затемнению мастер не закрывает', () => {
      const onClose = vi.fn();
      openFromButton('onboarding', onClose);
      act(() => {
        document.querySelector<HTMLElement>('.dlg-back')?.click();
      });
      expect(onClose).not.toHaveBeenCalled();
    });

    it('шаги мастера на месте: выбор языка, затем источники серверов', () => {
      openFromButton('onboarding');
      const dlg = dialog();
      expect(dlg.querySelectorAll('.onb-lang')).toHaveLength(5);
      const next = Array.from(dlg.querySelectorAll<HTMLButtonElement>('.dlg-f button')).find((b) =>
        b.classList.contains('btn-pri'),
      );
      act(() => {
        next?.click();
      });
      expect(dialog().querySelectorAll('.onb-src').length).toBeGreaterThanOrEqual(5);
    });
  });
});
