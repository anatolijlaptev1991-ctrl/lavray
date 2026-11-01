// SPDX-License-Identifier: GPL-3.0-only

// useRestartReset.test.tsx — флаг «нужен перезапуск ядра» гаснет, когда его дождались:
// отключились (профиль не запущен) или ядро перезапущено (новые клиенты).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import type { JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CoreState } from '../gen/lavray_pb';
import { createCoreClients } from '../lib/core';
import { clearRestartNeeded, getRestartNeeded, markRestartNeeded } from '../lib/restartNeeded';
import { CoreContext } from './useCore';
import { useRestartReset } from './useRestartReset';

function Probe({ state }: { state: CoreState }): JSX.Element | null {
  useRestartReset(state);
  return null;
}

describe('useRestartReset', () => {
  let root: Root;
  let clients = createCoreClients('http://127.0.0.1:1');
  const render = (state: CoreState): void => {
    act(() => {
      root.render(
        <CoreContext.Provider value={clients}>
          <Probe state={state} />
        </CoreContext.Provider>,
      );
    });
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    clearRestartNeeded();
    clients = createCoreClients('http://127.0.0.1:1');
    root = createRoot(document.body.appendChild(document.createElement('div')));
  });
  afterEach(() => {
    act(() => {
      root.unmount();
    });
    clearRestartNeeded();
  });

  it('пока соединение живо, флаг держится; отключение (в IDLE) его гасит', () => {
    render(CoreState.CONNECTED);
    act(() => {
      markRestartNeeded();
    });
    render(CoreState.CONNECTED);
    expect(getRestartNeeded()).toBe(true);
    render(CoreState.DISCONNECTING);
    expect(getRestartNeeded()).toBe(true);
    render(CoreState.IDLE);
    expect(getRestartNeeded()).toBe(false);
  });

  it('перезапуск ядра (новые клиенты) гасит флаг', () => {
    render(CoreState.CONNECTED);
    act(() => {
      markRestartNeeded();
    });
    clients = createCoreClients('http://127.0.0.1:2');
    render(CoreState.CONNECTED);
    expect(getRestartNeeded()).toBe(false);
  });

  it('запуск окна начинает с чистого флага: прежнего процесса, которого ждали, уже нет (B)', () => {
    act(() => {
      markRestartNeeded();
    });
    render(CoreState.IDLE);
    expect(getRestartNeeded()).toBe(false);
  });
});
