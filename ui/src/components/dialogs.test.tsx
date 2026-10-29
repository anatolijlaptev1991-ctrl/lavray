// dialogs.test.tsx — проверка переноса из Happ/v2rayN и независимых режимов
// в онбординге (DOM-проверка вместо визуальной: шаги мастера интерактивны).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { createElement } from 'react';
import { CoreContext } from '../hooks/useCore';
import { createCoreClients } from '../lib/core';
import { OnboardingDialog } from './dialogs';
import { t } from '../lib/i18n';

describe('OnboardingDialog', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  function render(onOpenImport = vi.fn()): void {
    const clients = createCoreClients('http://127.0.0.1:1');
    act(() => {
      root?.render(
        createElement(
          CoreContext.Provider,
          { value: clients },
          createElement(OnboardingDialog, { onClose: vi.fn(), onOpenImport }),
        ),
      );
    });
  }

  it('предлагает зашифрованную ссылку и перенос из v2rayN на шаге «Сервер»', () => {
    render();
    // шаг 1 → шаг 2
    const next = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Далее' || b.textContent === 'Next',
    );
    act(() => {
      next?.click();
    });
    const labels = Array.from(document.querySelectorAll('.onb-src')).map((e) => e.textContent ?? '');
    expect(labels.some((l) => l.includes(t('onb.src.happ')))).toBe(true);
    // Название стороннего клиента в интерфейсе не показываем (требование 14).
    expect(labels.some((l) => l.includes('Happ'))).toBe(false);
    expect(labels.some((l) => l.includes('v2rayN'))).toBe(true);
  });

  it('открывает импорт на нужной вкладке', () => {
    const onOpenImport = vi.fn();
    render(onOpenImport);
    const next = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Далее' || b.textContent === 'Next',
    );
    act(() => {
      next?.click();
    });
    const v2ray = Array.from(document.querySelectorAll('.onb-src')).find((e) =>
      (e.textContent ?? '').includes('v2rayN'),
    );
    act(() => {
      (v2ray as HTMLElement | undefined)?.click();
    });
    expect(onOpenImport).toHaveBeenCalledWith('file');
  });

  it('режимы системного прокси и TUN независимы (оба могут быть включены)', () => {
    render();
    const next = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Далее' || b.textContent === 'Next',
    );
    // шаг 1 → 2 → 3
    act(() => {
      next?.click();
    });
    const later = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').includes('позже') || (b.textContent ?? '').includes('later'),
    );
    act(() => {
      later?.click();
    });
    const switches = Array.from(document.querySelectorAll('.onb-mode-row [role="switch"]'));
    expect(switches.length).toBe(2);
    const first = switches[0] as HTMLElement;
    const second = switches[1] as HTMLElement;
    expect(first.getAttribute('aria-checked')).toBe('true');
    expect(second.getAttribute('aria-checked')).toBe('false');
    act(() => {
      second.click();
    });
    // после включения TUN системный прокси НЕ выключился
    expect(switches[0]?.getAttribute('aria-checked')).toBe('true');
    expect(switches[1]?.getAttribute('aria-checked')).toBe('true');
  });
});
