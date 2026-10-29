// SPDX-License-Identifier: GPL-3.0-only

// T-23: в списке серверов результат «тест не применим» (n/a от ядра) —
// это «н/д», а не ✕ «недоступен»; фильтр «Недоступные» его не включает.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import { ProfileSchema, ProfileType, TestResultSchema } from '../gen/lavray_pb';
import { CoreContext } from '../hooks/useCore';
import type { CoreClients } from '../lib/core';
import { setLanguage } from '../lib/i18n';
import { ServersScreen } from './screen_servers';

function profile(id: bigint, name: string, type: ProfileType, testResult: object): ReturnType<typeof create<typeof ProfileSchema>> {
  return create(ProfileSchema, {
    id,
    groupId: 1n,
    type,
    name,
    address: `203.0.113.${String(id)}`,
    port: 443,
    testResult: create(TestResultSchema, testResult),
  });
}

describe('ServersScreen: результат теста n/a', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setLanguage('ru');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  async function mount(): Promise<void> {
    const profiles = [
      profile(1n, 'hy2-live', ProfileType.HYSTERIA2, {
        lastError: 'n/a: Hysteria2 работает по UDP/QUIC — TCP-пинг неприменим',
      }),
      profile(2n, 'trojan-down', ProfileType.TROJAN, { lastError: 'dial tcp 203.0.113.2:443: i/o timeout' }),
      profile(3n, 'trojan-ok', ProfileType.TROJAN, { latencyMs: 42 }),
    ];
    const clients = {
      profiles: {
        listGroups: () => Promise.resolve({ groups: [] }),
        listProfiles: () => Promise.resolve({ profiles, total: 3n }),
      },
    } as unknown as CoreClients;
    await act(async () => {
      root?.render(createElement(CoreContext.Provider, { value: clients }, createElement(ServersScreen)));
      await Promise.resolve();
    });
  }

  function row(name: string): HTMLElement {
    const li = Array.from(container.querySelectorAll<HTMLElement>('.prow')).find(
      (el) => el.querySelector('.prow-name')?.textContent === name,
    );
    if (li === undefined) throw new Error(`строки ${name} нет в списке`);
    return li;
  }

  it('n/a показывается как «н/д» без отметки ошибки, недоступный — с ней', async () => {
    await mount();
    const na = row('hy2-live').querySelector('.prow-lat');
    expect(na?.textContent).toBe('н/д');
    expect(na?.classList.contains('err')).toBe(false);

    const down = row('trojan-down').querySelector('.prow-lat');
    expect(down?.classList.contains('err')).toBe(true);

    expect(row('trojan-ok').querySelector('.prow-lat')?.textContent).toContain('42');
  });

  it('фильтр «Недоступные» не включает профили с n/a', async () => {
    await mount();
    const chip = Array.from(container.querySelectorAll<HTMLButtonElement>('.chip')).find(
      (b) => b.textContent === 'Недоступные',
    );
    expect(chip).toBeDefined();
    await act(async () => {
      chip?.click();
      await Promise.resolve();
    });
    const names = Array.from(container.querySelectorAll('.prow .prow-name')).map((e) => e.textContent);
    expect(names).toEqual(['trojan-down']);
  });
});
