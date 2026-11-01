// SPDX-License-Identifier: GPL-3.0-only

// PlatformRows.test.tsx — T-76: в веб-режиме возможности оболочки скрыты, а в
// окне приложения нет панели сессий.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { CoreContext } from '../../hooks/useCore';
import { createCoreClients } from '../../lib/core';
import { setLanguage } from '../../lib/i18n';
import { getPlatformAdapter } from '../../platform/adapter';
import { WebSessionContext } from '../../screens/web/WebSessionContext';
import { mountBare, unmountAll, type Mounted } from '../../test-utils/coreStub';
import { stubWebCore } from '../../test-utils/webKit';
import { PlatformRows } from './PlatformRows';

const invokeMock = vi.hoisted(() => vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
}

beforeEach(() => {
  setLanguage('en');
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({
    supported: true,
    enabled: false,
    method: null,
    elevated: false,
    installed: true,
    unknown: false,
    notice: null,
  });
});
afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
  delete (window as TauriWindow).__TAURI_INTERNALS__;
});

const mountRows = (gate: boolean): Promise<Mounted> =>
  mountBare(
    createElement(
      CoreContext.Provider,
      { value: createCoreClients('http://localhost:3000', { mode: 'cookie', csrf: () => 'c' }) },
      createElement(
        WebSessionContext.Provider,
        { value: gate ? { username: 'admin', logout: () => Promise.resolve() } : null },
        createElement(PlatformRows),
      ),
    ),
  );

describe('возможности оболочки в веб-режиме', () => {
  it('web_mode_hides_native_features: нет автозапуска, трея, уведомлений; адаптер не обещает возможностей ОС', async () => {
    stubWebCore({ 'WebSessionService/ListSessions': { body: { sessions: [] } } });
    const v = await mountRows(true);
    for (const id of ['#autostartRow', '#closeToTrayRow', '#startMinimizedRow', '#notifyRow']) {
      expect(v.container.querySelector(id), id).toBeNull();
    }
    expect(invokeMock).not.toHaveBeenCalled(); // к оболочке не обращаемся
    expect(v.container.querySelector('#webSessions')).not.toBeNull();

    const caps = getPlatformAdapter(window).capabilities;
    expect(Object.values(caps).every((on) => !on)).toBe(true);
    expect(getPlatformAdapter(window).id).toBe('web');
  });

  it('в окне приложения строки оболочки есть, панели сессий нет', async () => {
    (window as TauriWindow).__TAURI_INTERNALS__ = {};
    const core = stubWebCore({});
    const v = await mountRows(false);
    expect(v.container.querySelector('#closeToTrayRow')).not.toBeNull();
    expect(v.container.querySelector('#autostartRow')).not.toBeNull();
    expect(v.container.querySelector('#webSessions')).toBeNull();
    expect(core.calls.some((c) => c.rpc.startsWith('WebSessionService/'))).toBe(false);
    expect(getPlatformAdapter(window).id).toBe('tauri');
  });
});
