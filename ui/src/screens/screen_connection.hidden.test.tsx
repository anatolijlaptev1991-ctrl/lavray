// SPDX-License-Identifier: GPL-3.0-only

// screen_connection.hidden.test.tsx — тик длительности сессии (раз в секунду)
// стоит, пока окно скрыто в трей; при показе тик возобновляется сразу.
// Ядро — мок fetch, как в screen_connection.traffic.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CoreContext } from '../hooks/useCore';
import { createCoreClients } from '../lib/core';
import { setLanguage } from '../lib/i18n';
import { ConnectionScreen } from './screen_connection';

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

const STARTED = String(Date.now() - 5000); // постоянное: иначе каждый опрос пересоздаёт тик

function installCore(): void {
  globalThis.fetch = (input: RequestInfo | URL): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(href).pathname;
    const body = path.endsWith('.CoreService/GetStatus')
      ? {
          state: 'CORE_STATE_CONNECTED',
          activeProfileId: '1',
          coreVersion: '1.14.1-lav.1',
          startedAtMs: STARTED,
          inbound: { port: 2080 },
        }
      : path.endsWith('.ProfileService/ListProfiles')
        ? { profiles: [{ id: '1', name: 'Frankfurt 01', address: 'example.org', port: 443 }] }
        : {};
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  };
}

const pause = (ms = 20): Promise<void> =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  });

describe('тик длительности сессии и скрытое окно', () => {
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    setLanguage('en');
    installCore();
    root = createRoot(document.body.appendChild(document.createElement('div')));
  });
  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.innerHTML = '';
    setHidden(false);
    vi.restoreAllMocks();
  });


  it('скрыто: интервала в 1 с нет; показ: интервал заводится и время пересчитывается', async () => {
    setHidden(true);
    const spy = vi.spyOn(globalThis, 'setInterval');
    const secondTicks = (): number => spy.mock.calls.filter(([, ms]) => ms === 1000).length;
    const clients = createCoreClients('http://127.0.0.1:1');
    act(() => {
      root.render(
        <CoreContext.Provider value={clients}>
          <ConnectionScreen />
        </CoreContext.Provider>,
      );
    });
    for (let i = 0; i < 40 && document.querySelector('#stateCard') === null; i += 1) await pause();
    await pause(60);
    expect(secondTicks()).toBe(0);

    act(() => {
      setHidden(false);
    });
    await pause(30);
    expect(secondTicks()).toBe(1);
  });
});
