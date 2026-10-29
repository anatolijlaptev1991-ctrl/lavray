// a11y-controls.test.tsx — T-61 (F-094, C1-23, C2-11, C2-13): возврат фокуса
// на кнопку-открывалку после ЛЮБОГО диалога, поля file доступны с клавиатуры,
// сообщения об успехе — live-регионы role="status". Размеры целей (24×24) и
// кольцо фокуса у чекбоксов — CSS, jsdom его не считает: см. Playwright-сценарий
// в tasks/T-61.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { CoreContext } from '../hooks/useCore';
import { createCoreClients } from '../lib/core';
import { setLanguage } from '../lib/i18n';
import { ConfirmDialog, DialogShell, GroupsDialog, HotkeysDialog, LicensesDialog } from './dialogs';
import { ImportDialog } from './ImportDialog';

function setActEnvironment(on: boolean): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = on;
}

function pressEscape(): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
}

describe('T-61: фокус и live-регионы', () => {
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

  describe('возврат фокуса на кнопку-открывалку после закрытия', () => {
    const kinds: readonly (readonly [string, (close: () => void) => ReactElement])[] = [
      ['ImportDialog', (close): ReactElement => <ImportDialog groupId={1n} onClose={close} onImported={() => undefined} />],
      ['GroupsDialog', (close): ReactElement => <GroupsDialog onClose={close} onChanged={() => undefined} />],
      ['HotkeysDialog', (close): ReactElement => <HotkeysDialog onClose={close} />],
      ['LicensesDialog', (close): ReactElement => <LicensesDialog onClose={close} />],
      [
        'ConfirmDialog',
        (close): ReactElement => <ConfirmDialog title="Delete" text="Sure?" confirmLabel="Delete" onConfirm={close} onClose={close} />,
      ],
    ];

    function Host({ make }: { make: (close: () => void) => ReactElement }): ReactElement {
      const [open, setOpen] = useState(false);
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
          {open && make(() => { setOpen(false); })}
        </>
      );
    }

    it.each(kinds)('%s: Esc возвращает фокус на кнопку, открывшую диалог', (_name, make) => {
      render(<Host make={make} />);
      const opener = document.querySelector<HTMLButtonElement>('#opener');
      if (opener === null) throw new Error('нет кнопки-открывалки');
      act(() => {
        opener.focus();
      });
      act(() => {
        opener.click();
      });
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(document.activeElement).not.toBe(opener);
      pressEscape();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
    });

    it('закрытие кнопкой «Закрыть» в подвале тоже возвращает фокус', () => {
      render(<Host make={(close): ReactElement => <HotkeysDialog onClose={close} />} />);
      const opener = document.querySelector<HTMLButtonElement>('#opener');
      act(() => {
        opener?.focus();
      });
      act(() => {
        opener?.click();
      });
      act(() => {
        document.querySelector<HTMLButtonElement>('.dlg-f .btn')?.click();
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
    });
  });

  describe('кнопки-открывалки уже нет', () => {
    it('после закрытия фокус уходит в основную область #main, а не пропадает на <body>', () => {
      const main = document.createElement('main');
      main.id = 'main';
      main.tabIndex = -1;
      document.body.append(main);

      function Host(): ReactElement {
        const [state, setState] = useState<'idle' | 'open' | 'gone'>('idle');
        return (
          <>
            {state !== 'gone' && (
              <button
                id="opener"
                onClick={() => {
                  setState('open');
                }}
              >
                open
              </button>
            )}
            {state !== 'idle' && (
              <DialogShell titleId="t61Title" title="T-61" onClose={() => { setState('idle'); }}>
                {/* пока диалог открыт, открывалка исчезает (закрытое меню, удалённая строка) */}
                <button
                  id="removeOpener"
                  onClick={() => {
                    setState('gone');
                  }}
                >
                  remove
                </button>
              </DialogShell>
            )}
          </>
        );
      }
      render(<Host />);
      act(() => {
        document.querySelector<HTMLButtonElement>('#opener')?.focus();
      });
      act(() => {
        document.querySelector<HTMLButtonElement>('#opener')?.click();
      });
      act(() => {
        document.querySelector<HTMLButtonElement>('#removeOpener')?.click();
      });
      expect(document.querySelector('#opener'), 'открывалка удалена').toBeNull();
      // закрываем диалог: Host сам его не снимает при state=gone — размонтируем целиком
      act(() => {
        root.render(<div />);
      });
      expect(document.activeElement).toBe(main);
    });

    it('вложенное подтверждение: открывалка удалена — фокус возвращается в нижний диалог', () => {
      function Host(): ReactElement {
        const [confirmOpen, setConfirmOpen] = useState(false);
        const [rowGone, setRowGone] = useState(false);
        return (
          <DialogShell titleId="lowT" title="lower" onClose={() => undefined}>
            {!rowGone && (
              <button
                id="rowDelete"
                onClick={() => {
                  setConfirmOpen(true);
                }}
              >
                delete row
              </button>
            )}
            {confirmOpen && (
              <ConfirmDialog
                title="Delete"
                text="Sure?"
                confirmLabel="Delete"
                onConfirm={() => {
                  setRowGone(true); // строка исчезает вместе с подтверждением
                  setConfirmOpen(false);
                }}
                onClose={() => {
                  setConfirmOpen(false);
                }}
              />
            )}
          </DialogShell>
        );
      }
      render(<Host />);
      act(() => {
        document.querySelector<HTMLButtonElement>('#rowDelete')?.focus();
      });
      act(() => {
        document.querySelector<HTMLButtonElement>('#rowDelete')?.click();
      });
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
      const dialogs = document.querySelectorAll('[role="dialog"]');
      const buttons = dialogs[dialogs.length - 1]?.querySelectorAll<HTMLButtonElement>('.dlg-f .btn') ?? [];
      act(() => {
        buttons[buttons.length - 1]?.click(); // «Delete» в подтверждении
      });
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      const lower = document.querySelector('[role="dialog"]');
      expect(document.activeElement, 'фокус остался внутри нижнего диалога').toBe(lower);
    });
  });

  describe('импорт: поля file доступны с клавиатуры', () => {
    it.each(['qr', 'file'] as const)('вкладка %s: input[type=file] не спрятан через display:none', (tab) => {
      render(<ImportDialog groupId={1n} initialTab={tab} onClose={() => undefined} onImported={() => undefined} />);
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(input).not.toBeNull();
      if (input === null) return;
      // display:none выводит поле из порядка Tab — фокус на него поставить нельзя
      expect(input.getAttribute('style') ?? '').not.toContain('display');
      expect(input.classList.contains('sr-only')).toBe(true);
      act(() => {
        input.focus();
      });
      expect(document.activeElement).toBe(input);
    });
  });

  describe('сообщения об успехе', () => {
    // Исходники экранов читаются как текст (import '*.css?raw' в vitest пустой, а '*.tsx?raw' — нет).
    const sources = import.meta.glob<string>('../**/*.tsx', { query: '?raw', import: 'default', eager: true });

    it('каждый элемент .toast-ok в приложении — live-регион role="status"', () => {
      let total = 0;
      const offenders: string[] = [];
      for (const [path, src] of Object.entries(sources)) {
        if (path.endsWith('.test.tsx')) continue;
        for (const m of src.matchAll(/<\w+\b[^>]*className="toast-ok"[^>]*>/g)) {
          total += 1;
          if (!m[0].includes('role="status"')) offenders.push(path);
        }
      }
      expect(total, 'сканер нашёл сообщения об успехе').toBeGreaterThanOrEqual(9);
      expect(offenders).toEqual([]);
    });
  });
});
