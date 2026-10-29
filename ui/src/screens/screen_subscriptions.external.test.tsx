// screen_subscriptions.external.test.tsx — T-58: кнопка «Открыть» (↗) на карточке
// подписки открывает ссылку через оболочку, а не window.open (в WebView2 он
// молча гасится). Ядро — мок fetch, оболочка — мок invoke.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CoreContext } from '../hooks/useCore';
import { createCoreClients } from '../lib/core';
import { setLanguage } from '../lib/i18n';
import { SubscriptionsScreen } from './screen_subscriptions';

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }));

const SUB_URL = 'https://provider.example/sub?token=abc';

function installCore(): void {
  globalThis.fetch = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = new URL(href).pathname.endsWith('.SubscriptionService/ListSubscriptions')
      ? { groups: [{ id: '1', name: 'Provider', subscriptionUrl: SUB_URL }] }
      : {};
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

describe('SubscriptionsScreen: open the subscription page', () => {
  let root: Root;
  let host: HTMLDivElement;
  let windowOpen: MockInstance<typeof window.open>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    setLanguage('en'); // на карточке несколько кнопок-иконок: ищем «Открыть» по подписи
    shell.invoke.mockReset().mockResolvedValue(null);
    windowOpen = vi.spyOn(window, 'open').mockReturnValue(null);
    installCore();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    windowOpen.mockRestore();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('goes through the shell opener, not window.open', async () => {
    const clients = createCoreClients('http://127.0.0.1:1');
    await act(async () => {
      root.render(
        <CoreContext.Provider value={clients}>
          <SubscriptionsScreen />
        </CoreContext.Provider>,
      );
      await Promise.resolve();
    });
    let button: HTMLButtonElement | null = null;
    for (let i = 0; i < 40 && button === null; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      button = document.querySelector<HTMLButtonElement>(
        '.sub-top button[aria-label="Open link"]',
      );
    }
    expect(button, 'кнопка «Открыть» на карточке подписки').not.toBeNull();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(shell.invoke).toHaveBeenCalledWith('plugin:opener|open_url', { url: SUB_URL });
    expect(windowOpen).not.toHaveBeenCalled();
  });
});
