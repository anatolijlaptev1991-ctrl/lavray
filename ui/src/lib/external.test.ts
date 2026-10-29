// SPDX-License-Identifier: GPL-3.0-only

// external.test.ts — T-58: внешние ссылки открываются в системном браузере
// только по http(s); файл, брошенный мимо зоны импорта, не уводит окно.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDropGuard, isExternalUrl, openExternal } from './external';

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }));

afterEach(() => {
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('external links', () => {
  it('accepts only absolute http(s) addresses', () => {
    for (const ok of ['https://github.com/a/b', 'http://example.com/a?b=c#d']) {
      expect(isExternalUrl(ok), ok).toBe(true);
    }
    for (const bad of [
      'javascript:alert(1)',
      'file:///C:/Windows/System32/calc.exe',
      'ms-msdt:/id PCWDiagnostic',
      'data:text/html,<script>1</script>',
      'mailto:a@b.c',
      '/relative',
      'https://exa mple.com',
      '',
    ]) {
      expect(isExternalUrl(bad), bad).toBe(false);
    }
  });

  it('opens through the shell opener plugin in the Tauri window, refusing other schemes', async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    shell.invoke.mockReset().mockResolvedValue(null);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    expect(await openExternal('https://example.com/sub')).toBe(true);
    expect(await openExternal('javascript:alert(1)')).toBe(false);
    expect(shell.invoke.mock.calls).toEqual([['plugin:opener|open_url', { url: 'https://example.com/sub' }]]);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens a new tab in the web panel', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(await openExternal('https://example.com')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
  });
});

describe('installDropGuard', () => {
  const drop = (types: string[]): Event => {
    const event = new Event('drop', { cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types } });
    window.dispatchEvent(event);
    return event;
  };

  it('cancels the default action for a dropped file, leaves text alone, stops after removal', () => {
    const remove = installDropGuard();
    expect(drop(['Files']).defaultPrevented).toBe(true);
    expect(drop(['text/plain']).defaultPrevented).toBe(false);
    remove();
    expect(drop(['Files']).defaultPrevented).toBe(false);
  });
});
