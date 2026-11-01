// SPDX-License-Identifier: GPL-3.0-only

// test-harness.ts — общие помощники vitest-тестов экранов и диалогов: клиенты
// ядра на настоящем транспорте с подменёнными методами (сеть не нужна),
// монтирование в act(), ввод текста и клики. Тестов в файле нет: vitest
// собирает только *.test.ts[x]. @testing-library в проекте не установлена,
// поэтому используется тот же createRoot + act, что в dialogs.test.tsx.
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import {
  CoreStatusSchema,
  GetTrafficSummaryResponseSchema,
  GroupSchema,
  Group_Kind,
  ListGroupsResponseSchema,
  ListPresetsResponseSchema,
  ListProfilesResponseSchema,
  ListSubscriptionsResponseSchema,
  ProfileSchema,
  ProfileType,
} from './gen/lavray_pb';
import type { Group, Profile } from './gen/lavray_pb';
import { CoreContext } from './hooks/useCore';
import { createCoreClients } from './lib/core';
import type { CoreClients } from './lib/core';

/** Встроенная группа «Default» из миграции ядра (store.DefaultGroupID). */
export const DEFAULT_GROUP_ID = 2147483000n;

export function groupOf(id: bigint, name: string): Group {
  return create(GroupSchema, { id, kind: Group_Kind.BASIC, name });
}

export function profileOf(id: number, name: string): Profile {
  return create(ProfileSchema, {
    id: BigInt(id),
    groupId: DEFAULT_GROUP_ID,
    type: ProfileType.VLESS,
    name,
    address: `${name.toLowerCase()}.example.org`,
    port: 443,
  });
}

/** Серверный стрим без кадров (для подписок, которые экраны открывают при монтировании). */
function emptyStream<T>(): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.resolve({ done: true as const, value: undefined }),
    }),
  };
}

export interface FakeCoreOptions {
  readonly profiles?: readonly Profile[];
  /** По умолчанию одна группа «Default»; [] — список групп пуст. */
  readonly groups?: readonly Group[];
}

/**
 * Клиенты на настоящем транспорте (адрес-пустышка), у которых заменены
 * методы, вызываемые экранами при монтировании. Остальные методы тест
 * подменяет сам: vi.spyOn(clients.profiles, 'importContent').
 */
export function makeClients(opts: FakeCoreOptions = {}): CoreClients {
  const profiles = [...(opts.profiles ?? [])];
  const groups = [...(opts.groups ?? [groupOf(DEFAULT_GROUP_ID, 'Default')])];
  const c = createCoreClients('http://127.0.0.1:1');
  vi.spyOn(c.core, 'getStatus').mockResolvedValue(create(CoreStatusSchema, {}));
  vi.spyOn(c.profiles, 'listProfiles').mockResolvedValue(
    create(ListProfilesResponseSchema, { profiles, total: BigInt(profiles.length) }),
  );
  vi.spyOn(c.profiles, 'listGroups').mockResolvedValue(create(ListGroupsResponseSchema, { groups }));
  vi.spyOn(c.subscriptions, 'listSubscriptions').mockResolvedValue(
    create(ListSubscriptionsResponseSchema, {}),
  );
  vi.spyOn(c.routing, 'listPresets').mockResolvedValue(create(ListPresetsResponseSchema, {}));
  vi.spyOn(c.stats, 'subscribe').mockImplementation(() => emptyStream());
  vi.spyOn(c.stats, 'getTrafficSummary').mockResolvedValue(create(GetTrafficSummaryResponseSchema, {}));
  vi.spyOn(c.diagnostics, 'getPublicIp').mockRejectedValue(new Error('Failed to fetch'));
  return c;
}

export interface Mounted {
  readonly container: HTMLDivElement;
  readonly unmount: () => void;
}

export async function flush(ms = 20): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Монтирует элемент внутрь CoreContext и ждёт первые асинхронные эффекты. */
export async function mountWithCore(clients: CoreClients, element: ReactElement): Promise<Mounted> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(CoreContext.Provider, { value: clients }, element));
  });
  await flush(30);
  return {
    container,
    unmount: (): void => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

export async function click(el: Element | null | undefined): Promise<void> {
  if (el === null || el === undefined) throw new Error('click: элемент не найден');
  act(() => {
    (el as HTMLElement).click();
  });
  await flush(10);
}

/** Ввод в управляемое поле React: нативный setter + событие input. */
export function typeInto(input: HTMLInputElement | null, value: string): void {
  if (input === null) throw new Error('typeInto: поле не найдено');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Кнопка по точному видимому тексту (тесты идут на английском словаре). */
export function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => (b.textContent ?? '').trim() === text,
  );
  if (found === undefined) throw new Error(`кнопка «${text}» не найдена`);
  return found;
}
