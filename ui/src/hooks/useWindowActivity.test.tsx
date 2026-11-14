// SPDX-License-Identifier: GPL-3.0-only

// useWindowActivity.test.tsx — html[data-active] следует за видимостью и фокусом окна.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { mount, unmountAll } from '../test-utils/coreStub';
import { isWindowActive, useWindowActivity } from './useWindowActivity';

function Probe(): null {
  useWindowActivity();
  return null;
}

const active = (): string | undefined => document.documentElement.dataset.active;

function setVisibility(state: 'visible' | 'hidden'): void {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
}

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe('useWindowActivity', () => {
  it('в фокусе и видимо: 1; скрыто: 0; снова видимо: 1', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setVisibility('visible');
    await mount(createElement(Probe));
    expect(active()).toBe('1');

    setVisibility('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(active()).toBe('0');

    setVisibility('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(active()).toBe('1');
  });

  it('потеря фокуса даёт 0, возврат фокуса даёт 1', async () => {
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setVisibility('visible');
    await mount(createElement(Probe));

    focus.mockReturnValue(false);
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
      await Promise.resolve();
    });
    expect(active()).toBe('0');

    focus.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    expect(active()).toBe('1');
  });

  it('при размонтировании атрибут снимается', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setVisibility('visible');
    await mount(createElement(Probe));
    unmountAll();
    expect(active()).toBeUndefined();
  });

  it('isWindowActive: скрытое окно неактивно, даже если фокус числится за ним', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setVisibility('hidden');
    expect(isWindowActive(document)).toBe(false);
  });
});
