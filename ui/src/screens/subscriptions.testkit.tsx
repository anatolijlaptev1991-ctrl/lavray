// SPDX-License-Identifier: GPL-3.0-only

// subscriptions.testkit.tsx — общие заготовки тестов экрана «Подписки»
// (создаёт T-18; используют тесты T-21 и T-68). Не тест: vitest берёт *.test.tsx.
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { CoreContext } from '../hooks/useCore';
import type { CoreClients } from '../lib/core';
import { setLanguage } from '../lib/i18n';
import {
  Group_Kind,
  GroupSchema,
  ListProfilesResponseSchema,
  ListSubscriptionsResponseSchema,
  SubscriptionProgressSchema,
  type SubscriptionProgress,
  type SubscriptionProgress_Phase,
} from '../gen/lavray_pb';
import { SubscriptionsScreen } from './screen_subscriptions';

type GroupInit = MessageInitShape<typeof GroupSchema>;

/** Подписка «Prov»; в ней три сервера (listProfiles отдаёт total = 3). */
export const PROV: GroupInit = { id: 7n, name: 'Prov', subscriptionUrl: 'https://prov.example/sub' };

export const frame = (
  phase: SubscriptionProgress_Phase,
  extra: MessageInitShape<typeof SubscriptionProgressSchema> = {},
): SubscriptionProgress => create(SubscriptionProgressSchema, { groupId: 7n, phase, ...extra });

/** Один вызов updateSubscription: кадры и (необязательно) ошибка в конце потока. */
export interface Run {
  readonly frames: readonly SubscriptionProgress[];
  readonly endWith?: Error;
}

/** Фейковое ядро: подписки `groups`, потоки обновления по сценарию `runs`. */
export function fakeCore(
  groups: readonly GroupInit[],
  runs: readonly Run[] = [],
): { core: CoreClients; update: ReturnType<typeof vi.fn> } {
  const queue = [...runs];
  const update = vi.fn((_req: unknown) => {
    const run = queue.shift();
    return (async function* (): AsyncGenerator<SubscriptionProgress> {
      await Promise.resolve(); // как сеть: кадры приходят асинхронно
      if (run === undefined) throw new Error('неожиданный вызов updateSubscription');
      for (const f of run.frames) yield f;
      if (run.endWith !== undefined) throw run.endWith;
    })();
  });
  const list = create(ListSubscriptionsResponseSchema, {
    groups: groups.map((g) => create(GroupSchema, { kind: Group_Kind.SUBSCRIPTION, ...g })),
  });
  const core = {
    subscriptions: { listSubscriptions: vi.fn(() => Promise.resolve(list)), updateSubscription: update },
    profiles: { listProfiles: vi.fn(() => Promise.resolve(create(ListProfilesResponseSchema, { total: 3n }))) },
  } as unknown as CoreClients;
  return { core, update };
}

/** Монтирование экрана с чисткой между тестами; язык интерфейса — ru. */
export function subscriptionsHarness(): {
  mount: (core: CoreClients) => Promise<void>;
  click: (el: Element | null) => Promise<void>;
  settle: () => Promise<void>;
} {
  let root: Root | undefined;
  let host: HTMLDivElement;
  const settle = async (): Promise<void> => {
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  };
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setLanguage('ru');
    window.localStorage.clear();
    host = document.createElement('div');
    document.body.append(host);
  });
  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    host.remove();
    setLanguage('en');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });
  return {
    settle,
    mount: async (core): Promise<void> => {
      act(() => {
        root?.unmount(); // повторный mount = «перезагрузка» экрана
      });
      root = createRoot(host);
      act(() => {
        root?.render(createElement(CoreContext.Provider, { value: core }, createElement(SubscriptionsScreen)));
      });
      await settle();
    },
    click: async (el): Promise<void> => {
      expect(el).not.toBeNull();
      act(() => {
        (el as HTMLElement).click();
      });
      await settle();
    },
  };
}
