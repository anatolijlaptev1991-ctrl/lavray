// settingsKit.tsx — общий стенд для тестов экрана «Настройки»: монтирует
// SettingsScreen с поддельным клиентом ядра (без сети). Настройки отдаёт
// getSettings, записи фиксирует мок setSettings.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import { vi, type Mock } from 'vitest';
import { SettingValueSchema, type SettingValue } from '../gen/lavray_pb';
import { CoreContext } from '../hooks/useCore';
import type { CoreClients } from '../lib/core';
import { SettingsScreen } from '../screens/screen_settings';

export type RawSettings = Readonly<Record<string, string | boolean | number>>;

interface SetSettingsRequest {
  readonly values: Readonly<Record<string, SettingValue>>;
}

export interface SettingsHarness {
  readonly container: HTMLElement;
  /** Мок RPC SetSettings: acceptedKeys = все присланные ключи. */
  readonly setSettings: Mock<(req: SetSettingsRequest) => Promise<{ acceptedKeys: string[] }>>;
  readonly unmount: () => void;
}

export function settingValue(raw: string | boolean | number): SettingValue {
  if (typeof raw === 'boolean') return create(SettingValueSchema, { value: { case: 'boolValue', value: raw } });
  if (typeof raw === 'number') {
    return create(SettingValueSchema, { value: { case: 'intValue', value: BigInt(raw) } });
  }
  return create(SettingValueSchema, { value: { case: 'stringValue', value: raw } });
}

/** Дать завершиться промисам эффектов и перерисовке. */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/** Смонтировать «Настройки»; initial — то, что вернёт GetSettings. */
export async function mountSettings(
  initial: RawSettings = {},
  coreVersion = '9.9.9-core',
): Promise<SettingsHarness> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const setSettings = vi.fn((req: SetSettingsRequest): Promise<{ acceptedKeys: string[] }> =>
    Promise.resolve({ acceptedKeys: Object.keys(req.values) }),
  );
  const values: Record<string, SettingValue> = {};
  for (const [k, v] of Object.entries(initial)) values[k] = settingValue(v);
  const fake = {
    settings: {
      describeSettings: vi.fn(() => Promise.resolve({ descriptors: [] })),
      getSettings: vi.fn(() => Promise.resolve({ values })),
      setSettings,
    },
    core: { getStatus: vi.fn(() => Promise.resolve({ coreVersion })) },
  } as unknown as CoreClients;

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(CoreContext.Provider, { value: fake }, createElement(SettingsScreen)));
  });
  await flush();
  return {
    container,
    setSettings,
    unmount: (): void => {
      act(() => {
        root.unmount();
      });
      container.remove();
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    },
  };
}

/** Все переключатели экрана с их подписями. */
export function switches(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="switch"]'));
}
