// SPDX-License-Identifier: GPL-3.0-only

// connsKit.ts — помощники тестов T-79 (соединения и статистика): построители
// сообщений, управляемый поток кадров и монтирование с подставным ядром.
// Поток управляется из теста (push/fail/end), поэтому паузу, обрыв и
// переподключение можно проверять по шагам, в том числе на фейковых таймерах.
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import { vi } from 'vitest';
import { ConnectionSchema, ConnectionSnapshotSchema, Connection_Status } from '../gen/lavray_pb';
import type { Connection, ConnectionSnapshot } from '../gen/lavray_pb';
import { CoreContext } from '../hooks/useCore';
import type { CoreClients } from '../lib/core';

type ConnInit = Partial<Omit<Connection, '$typeName' | '$unknown'>>;

/** Активное TCP-соединение через `proxy`; поля переопределяются. */
export function conn(id: string, init: ConnInit = {}): Connection {
  return create(ConnectionSchema, {
    id,
    startedAtMs: 1_700_000_000_000n,
    status: Connection_Status.ACTIVE,
    outbound: 'proxy',
    destination: `${id}.example.org:443`,
    network: 'tcp',
    chain: ['proxy'],
    ...init,
  });
}

export function frame(active: Connection[], closedIds: string[] = [], truncated = false): ConnectionSnapshot {
  return create(ConnectionSnapshotSchema, { active, closedIds, truncated });
}

type Item<T> = { readonly kind: 'frame'; readonly value: T } | { readonly kind: 'fail'; readonly error: unknown } | { readonly kind: 'end' };

export interface Open {
  readonly request: unknown;
  readonly signal: AbortSignal | undefined;
}

export interface Feed<T> {
  /** Подставляется как метод server-stream клиента: каждый вызов — новое открытие потока. */
  readonly stream: (request: unknown, options?: { signal?: AbortSignal }) => AsyncGenerator<T>;
  readonly push: (value: T) => void;
  /** Поток оборвётся этой ошибкой. */
  readonly fail: (error: unknown) => void;
  /** Поток закончится чисто. */
  readonly end: () => void;
  readonly opens: Open[];
}

export function createFeed<T>(): Feed<T> {
  const queue: Item<T>[] = [];
  const opens: Open[] = [];
  let wake: (() => void) | undefined;
  const put = (item: Item<T>): void => {
    queue.push(item);
    wake?.();
  };
  async function* stream(request: unknown, options?: { signal?: AbortSignal }): AsyncGenerator<T> {
    opens.push({ request, signal: options?.signal });
    for (;;) {
      if (options?.signal?.aborted === true) return;
      const item = queue.shift();
      if (item === undefined) {
        await new Promise<void>((resolve) => {
          const done = (): void => { resolve(); };
          wake = done;
          options?.signal?.addEventListener('abort', done, { once: true });
        });
        continue;
      }
      if (item.kind === 'fail') throw item.error;
      if (item.kind === 'end') return;
      yield item.value;
    }
  }
  return {
    stream,
    opens,
    push: (value): void => { put({ kind: 'frame', value }); },
    fail: (error): void => { put({ kind: 'fail', error }); },
    end: (): void => { put({ kind: 'end' }); },
  };
}

export interface Mounted {
  readonly container: HTMLElement;
  /** Перерисовывает с другим элементом (те же клиенты ядра). */
  readonly rerender: (element: ReactElement) => Promise<void>;
  readonly unmount: () => void;
}

/** Монтирует элемент с подставным ядром; ждёт только микрозадачи (подходит и фейковым таймерам). */
export async function mountWithCore(core: unknown, element: ReactElement): Promise<Mounted> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let mounted = true;
  const rerender = async (next: ReactElement): Promise<void> => {
    await act(async () => {
      root.render(createElement(CoreContext.Provider, { value: core as CoreClients }, next));
      await Promise.resolve();
    });
  };
  await rerender(element);
  return {
    container,
    rerender,
    unmount: (): void => {
      if (!mounted) return;
      mounted = false;
      act(() => { root.unmount(); });
      container.remove();
    },
  };
}

/** Даёт обработать накопленные микрозадачи (кадры потока) внутри act. */
export async function drain(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

/** Сдвигает фейковые таймеры внутри act. */
export async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
