// SPDX-License-Identifier: GPL-3.0-only

// useUpdateHealth.test.tsx — health_ok_once_after_ready (D, T-75): сигнал
// «ядро готово и первый кадр нарисован» уходит оболочке ровно один раз за запуск
// приложения. Помощник-наблюдатель оболочки по нему решает, что новая версия
// здорова; повторы и ранний вызов ломают откат.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { JSX } from 'react';
import { CoreState } from '../gen/lavray_pb';
import { setLanguage } from '../lib/i18n';
import { isCoreReady, resetUpdateHealthForTests, useUpdateHealth } from './useUpdateHealth';
import { useShellBridge } from './useShellBridge';

vi.mock('@tauri-apps/api/core', async () => (await import('../test-utils/tauriStub')).tauriCoreModule);
vi.mock('@tauri-apps/api/event', async () => (await import('../test-utils/tauriStub')).tauriEventModule);
const { tauri, enableTauri, disableTauri } = await import('../test-utils/tauriStub');

function Probe({ ready }: { readonly ready: boolean }): JSX.Element | null {
  useUpdateHealth(ready);
  return null;
}

let root: Root;
let host: HTMLDivElement;

const flush = (): Promise<void> =>
  act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });

async function render(ready: boolean, strict = false): Promise<void> {
  const probe = createElement(Probe, { ready });
  await act(async () => {
    root.render(strict ? createElement(StrictMode, null, probe) : probe);
    await Promise.resolve();
  });
  await flush();
}

const healthCalls = (): number => tauri.argsOf('update_health_ok').length;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  setLanguage('en');
  tauri.reset();
  tauri.onValue('update_health_ok', null);
  enableTauri();
  resetUpdateHealthForTests();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  disableTauri();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

describe('health_ok_once_after_ready', () => {
  it('до готовности ядра команда не вызывается', async () => {
    await render(false);
    await render(false);
    expect(healthCalls()).toBe(0);
  });

  it('готово — вызывается ровно один раз', async () => {
    await render(false);
    await render(true);
    expect(healthCalls()).toBe(1);
  });

  it('повторные рендеры с готовым ядром не вызывают команду снова', async () => {
    await render(true);
    await render(true);
    await render(true);
    expect(healthCalls()).toBe(1);
  });

  it('мерцание готовности true → false → true не даёт второго вызова', async () => {
    await render(true);
    await render(false);
    await render(true);
    expect(healthCalls()).toBe(1);
  });

  it('повторное монтирование (новый корень) не вызывает команду снова', async () => {
    await render(true);
    act(() => {
      root.unmount();
    });
    root = createRoot(host);
    await render(true);
    expect(healthCalls()).toBe(1);
  });

  it('StrictMode (двойной запуск эффектов) — один вызов', async () => {
    await render(true, true);
    expect(healthCalls()).toBe(1);
  });

  it('вне окна Tauri (веб-панель) команда не вызывается', async () => {
    disableTauri();
    await render(true);
    expect(healthCalls()).toBe(0);
  });

  it('сбой записи не блокирует навсегда: следующая готовность повторяет попытку', async () => {
    tauri.onError('update_health_ok', 'health_write_failed');
    await render(true);
    expect(healthCalls()).toBe(1);
    tauri.onValue('update_health_ok', null);
    await render(false);
    await render(true);
    expect(healthCalls()).toBe(2);
    await render(false);
    await render(true);
    expect(healthCalls()).toBe(2);
  });
});

describe('isCoreReady', () => {
  it('ядро готово, когда оно ответило версией (первый успешный GetStatus)', () => {
    expect(isCoreReady({ coreVersion: '0.5.0' })).toBe(true);
    expect(isCoreReady({ coreVersion: '' })).toBe(false);
    expect(isCoreReady({})).toBe(false);
  });
});

describe('подключение в useShellBridge', () => {
  function Bridge({ coreVersion }: { readonly coreVersion: string }): JSX.Element | null {
    useShellBridge({ state: CoreState.IDLE, coreVersion }, () => undefined, () => undefined);
    return null;
  }

  async function renderBridge(coreVersion: string): Promise<void> {
    await act(async () => {
      root.render(createElement(Bridge, { coreVersion }));
      await Promise.resolve();
    });
    await flush();
  }

  it('пока статус без версии ядра — тихо; с версией — один update_health_ok', async () => {
    await renderBridge('');
    expect(healthCalls()).toBe(0);
    await renderBridge('0.5.0');
    await renderBridge('0.5.0');
    expect(healthCalls()).toBe(1);
  });
});
