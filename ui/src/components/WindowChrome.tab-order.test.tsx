// SPDX-License-Identifier: GPL-3.0-only

// WindowChrome.tab-order.test.tsx — T-63: кнопки окна вне порядка Tab (прототип:
// tabindex="-1" у #wbMin/#wbMax/#wbClose/#wbCloseL; kbd_probe: window-buttons-not-tabbable).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WindowChrome } from './WindowChrome';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

function render(os: string): HTMLButtonElement[] {
  act(() => {
    root?.render(
      createElement(
        Fragment,
        null,
        createElement(WindowChrome, { os, placement: 'start' }),
        createElement(WindowChrome, { os, placement: 'end' }),
      ),
    );
  });
  return Array.from(host?.querySelectorAll('button') ?? []);
}

describe('кнопки окна и Tab', () => {
  it.each([
    ['windows', 3],
    ['macos', 3],
    ['linux', 1],
  ])('%s: все %i кнопки(а) вне порядка Tab, но остаются кнопками с именем', (os, expected) => {
    const buttons = render(os);
    expect(buttons).toHaveLength(expected);
    for (const b of buttons) {
      expect(b.tabIndex, b.className).toBe(-1);
      expect(b.getAttribute('aria-label') ?? '').not.toBe('');
    }
  });
});
