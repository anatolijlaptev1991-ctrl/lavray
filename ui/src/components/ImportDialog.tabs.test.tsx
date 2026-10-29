// T-38 (C1-04, C2-03): вкладки «Ссылка / QR-код / Файл» диалога импорта
// переключаются стрелками, Home и End; у вкладок есть id и aria-controls,
// у панелей — aria-labelledby (прототип: dlgImport, #impTabs, #impPane-*).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CoreContext } from '../hooks/useCore';
import { createCoreClients } from '../lib/core';
import { setLanguage } from '../lib/i18n';
import { ImportDialog } from './ImportDialog';

describe('T-38: вкладки диалога импорта', () => {
  let root: Root;
  let container: HTMLDivElement;

  // T-06: диалог на портале в body, поэтому ищем по документу, а не внутри container.
  const tabs = (): HTMLButtonElement[] =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tablist"] [role="tab"]'));
  const selected = (): (string | null)[] => tabs().map((b) => b.getAttribute('aria-selected'));

  async function press(el: Element | undefined, key: string): Promise<void> {
    await act(async () => {
      el?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setLanguage('en');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const clients = createCoreClients('http://127.0.0.1:1');
    act(() => {
      root.render(
        createElement(
          CoreContext.Provider,
          { value: clients },
          createElement(ImportDialog, { groupId: 1n, onClose: vi.fn(), onImported: vi.fn() }),
        ),
      );
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  it('→ переходит от «Ссылки» к «QR-коду», потом к «Файлу», потом по кругу к «Ссылке»', async () => {
    expect(tabs().map((b) => b.textContent)).toEqual(['Link', 'QR code', 'File']);
    tabs()[0]?.focus();
    await press(tabs()[0], 'ArrowRight');
    expect(selected()).toEqual(['false', 'true', 'false']);
    expect(document.activeElement).toBe(tabs()[1]);
    await press(tabs()[1], 'ArrowRight');
    expect(selected()).toEqual(['false', 'false', 'true']);
    await press(tabs()[2], 'ArrowRight');
    expect(selected()).toEqual(['true', 'false', 'false']);
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it('←, Home и End', async () => {
    tabs()[0]?.focus();
    await press(tabs()[0], 'ArrowLeft');
    expect(selected()).toEqual(['false', 'false', 'true']);
    await press(tabs()[2], 'Home');
    expect(selected()).toEqual(['true', 'false', 'false']);
    await press(tabs()[0], 'End');
    expect(selected()).toEqual(['false', 'false', 'true']);
    expect(document.querySelector('[role="tabpanel"]')).not.toBeNull();
  });

  it('выбранная вкладка ссылается на свою панель, а панель — на вкладку', async () => {
    for (let i = 0; i < 3; i += 1) {
      const tab = tabs()[i];
      const controls = tab?.getAttribute('aria-controls') ?? '';
      expect(controls, `aria-controls у выбранной вкладки №${String(i)}`).not.toBe('');
      const panel = document.getElementById(controls);
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab?.id);
      expect(tab?.id).not.toBe('');
      await press(tab, 'ArrowRight');
    }
  });
});
