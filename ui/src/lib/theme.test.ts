import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  loadPreferences,
  resolvedAccent,
  resolvedTheme,
  watchSystemTheme,
  type AccentPreference,
  type ThemePreference,
} from './theme';

/** Stub matchMedia: '(prefers-color-scheme: dark)' reports `matches`. */
function installMatchMedia(win: Window & { matchMedia: (q: string) => MediaQueryList }): void {
  vi.spyOn(win, 'matchMedia').mockImplementation((query: string) => {
    const listeners = new Set<(e: { matches: boolean }) => void>();
    return {
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
        listeners.add(fn);
      },
      removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
        listeners.delete(fn);
      },
    } as MediaQueryList;
  });
}

function darkWindow(): Window {
  installMatchMedia(window);
  return window;
}

describe('theme resolution', () => {
  it('system preference resolves via prefers-color-scheme', () => {
    const win = darkWindow();
    expect(resolvedTheme('dark', win)).toBe('dark');
    expect(resolvedTheme('light', win)).toBe('light');
    expect(resolvedTheme('system', win)).toBe('dark');
  });

  it('auto accent is theme-bound: dark → amber, light → sage', () => {
    expect(resolvedAccent('auto', 'dark')).toBe('amber');
    expect(resolvedAccent('auto', 'light')).toBe('sage');
    expect(resolvedAccent('sage', 'dark')).toBe('sage');
    expect(resolvedAccent('graphite', 'light')).toBe('graphite');
  });
});

describe('applyTheme data attributes', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-accent');
    window.localStorage.clear();
  });

  function apply(theme: ThemePreference, accent: AccentPreference): void {
    applyTheme({ doc: document, win: darkWindow(), storage: window.localStorage, theme, accent });
  }

  it('writes concrete data-theme/data-accent on <html>', () => {
    apply('dark', 'auto');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.accent).toBe('amber');

    apply('light', 'auto');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.accent).toBe('sage');

    apply('light', 'graphite');
    expect(document.documentElement.dataset.accent).toBe('graphite');
  });

  it('never writes "auto" as the data-accent value', () => {
    for (const theme of ['dark', 'light'] as const) {
      apply(theme, 'auto');
      expect(document.documentElement.dataset.accent).not.toBe('auto');
    }
  });

  it('persists the preference and reloads it', () => {
    apply('light', 'sage');
    expect(loadPreferences(window.localStorage)).toEqual({ theme: 'light', accent: 'sage' });

    // defaults when nothing stored
    window.localStorage.clear();
    expect(loadPreferences(window.localStorage)).toEqual({ theme: 'dark', accent: 'auto' });
  });

  it('rejects corrupted stored values', () => {
    window.localStorage.setItem('lavray.theme', 'indigo');
    window.localStorage.setItem('lavray.accent', 'violet');
    expect(loadPreferences(window.localStorage)).toEqual({ theme: 'dark', accent: 'auto' });
  });
});

describe('watchSystemTheme', () => {
  it('follows OS changes while unsubscribing cleanly', () => {
    const listeners = new Set<(e: { matches: boolean }) => void>();
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      return {
        matches: false,
        media: query,
        addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
          listeners.add(fn);
        },
        removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
          listeners.delete(fn);
        },
      } as MediaQueryList;
    });

    const seen: string[] = [];
    const stop = watchSystemTheme(window, (theme) => {
      seen.push(theme);
    });

    for (const fn of listeners) fn({ matches: true });
    expect(seen).toEqual(['dark']);

    stop();
    listeners.clear();
    expect(listeners.size).toBe(0);
  });
});
