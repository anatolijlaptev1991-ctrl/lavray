// SPDX-License-Identifier: GPL-3.0-only

// DiffView.test.tsx — T-08B: разметка diff. Добавленные и удалённые строки различаются
// знаком, а не только цветом; видны номера старой и новой строки; область доступна
// с клавиатуры и названа.
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { DiffView } from './DiffView';

const DIFF = [
  '--- before',
  '+++ after',
  '@@ -3,3 +3,3 @@',
  ' keep',
  '-old',
  '+new',
  '\\ No newline at end of file',
].join('\n');

describe('DiffView', () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;

  function render(diff: string): HTMLElement {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(createElement(DiffView, { diff, label: 'Config changes' }));
    });
    const region = host.querySelector<HTMLElement>('[role="region"]');
    if (region === null) throw new Error('нет области diff');
    return region;
  }

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  const rowTexts = (region: HTMLElement): string[] =>
    Array.from(region.querySelectorAll('.df-l')).map((row) =>
      Array.from(row.children)
        .map((c) => c.textContent)
        .join('|'),
    );

  it('область названа, фокусируется с клавиатуры (прокручиваемая) и одна на весь diff', () => {
    const region = render(DIFF);
    expect(region.getAttribute('aria-label')).toBe('Config changes');
    expect(region.tabIndex).toBe(0);
    expect(region.classList.contains('diffv')).toBe(true);
  });

  it('строки: класс по виду, знак «+» / «−» и номера старой и новой строки', () => {
    const region = render(DIFF);
    expect(rowTexts(region)).toEqual([
      '--- before',
      '+++ after',
      '@@ -3,3 +3,3 @@',
      '3|3||keep',
      '4||−|old',
      '|4|+|new',
      '\\ No newline at end of file',
    ]);
    const kinds = Array.from(region.querySelectorAll('.df-l')).map((r) =>
      Array.from(r.classList)
        .find((c) => c.startsWith('df-') && c !== 'df-l')
        ?.slice(3),
    );
    expect(kinds).toEqual(['file', 'file', 'hunk', 'ctx', 'del', 'add', 'meta']);
  });

  it('номера строк скрыты от скринридера, знак остаётся в тексте строки', () => {
    const region = render(DIFF);
    for (const no of region.querySelectorAll('.df-no')) expect(no.getAttribute('aria-hidden')).toBe('true');
    expect(region.querySelector('.df-add .df-sg')?.getAttribute('aria-hidden')).toBeNull();
  });

  it('текст строки вставляется как текст, а не как разметка', () => {
    const region = render(['--- b', '+++ a', '@@ -1 +1 @@', '+<img src=x onerror=alert(1)>'].join('\n'));
    expect(region.querySelector('img')).toBeNull();
    expect(region.querySelector('.df-add .df-tx')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
