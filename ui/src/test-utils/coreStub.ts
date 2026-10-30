// SPDX-License-Identifier: GPL-3.0-only

// coreStub.ts — помощники тестов экрана «Подключение»: ядро подменено на уровне
// fetch, клиенты и разбор ответов настоящие. Ответы заданы JSON-ом в том виде,
// в каком их отдаёт protojson ядра (нулевые поля опущены, int64 — строки).
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { vi } from 'vitest';
import { CoreContext } from '../hooks/useCore';
import { createCoreClients } from '../lib/core';
import { decodeConnectBody, StreamReply, streamFetch } from './streamStub';

/** Дословный GetStatus ядра в простое (go-тест TestB1_TunStatusAndWarning): поля active_profile_id нет. */
export const RAW_IDLE_STATUS =
  '{"mode":"CONNECT_MODE_SYSTEM_PROXY", "coreVersion":"0.1.0-w6", "inbound":{"listen":"127.0.0.1", "port":2080}, "routingPresetId":"global", "tun":{"interfaceName":"lavray-tun"}}';

export type Json = Record<string, unknown>;

export const idleStatus = (): Json => JSON.parse(RAW_IDLE_STATUS) as Json;

export const connectedStatus = (id: string, name: string, mode = 'CONNECT_MODE_SYSTEM_PROXY'): Json => ({
  ...idleStatus(),
  state: 'CORE_STATE_CONNECTED',
  activeProfileId: id,
  activeProfileName: name,
  mode,
  startedAtMs: String(Date.now() - 5000),
});

/** Старт не удался: инстанс в Crashed, текст — inst.Status.LastError. */
export const errorStatus = (lastError: string): Json => ({
  ...idleStatus(),
  state: 'CORE_STATE_ERROR',
  lastError,
});

export const connectingStatus = (id: string, name: string): Json => ({
  ...idleStatus(),
  state: 'CORE_STATE_CONNECTING',
  activeProfileId: id,
  activeProfileName: name,
});

export function profile(id: string, name: string, extra: Json = {}): Json {
  return {
    id,
    groupId: '2147483000',
    type: 'PROFILE_TYPE_VLESS',
    name,
    address: `${name.toLowerCase()}.example.org`,
    port: 443,
    trojanVless: { password: 'b831381d-6324-4d53-ad4f-8cda48b30811' },
    ...extra,
  };
}

/** Ответ ListProfiles. */
export const profileList = (...items: Json[]): Json => ({ profiles: items, total: String(items.length) });

/** Ответ-ошибка ядра (код ConnectRPC и текст). */
export class Failure {
  constructor(
    readonly code: string,
    readonly message: string,
  ) {}
}

/** Ядро недоступно: fetch отклоняется, как при закрытом порте. */
export class Down {
  readonly down = true;
}

type Reply = Json | Failure | Down | StreamReply;
type RouteFn = (call: number, body: unknown) => Reply;
/** Ответ на RPC или функция (номер вызова с 0, тело запроса) → ответ. */
export type Route = Reply | RouteFn;

const isRouteFn = (r: Route): r is RouteFn => typeof r === 'function';

export interface CoreStub {
  /** «Сервис/Метод» → ответ; тест может подменять ответы по ходу. */
  readonly routes: Record<string, Route>;
  /** Все вызовы по порядку. */
  readonly calls: { readonly rpc: string; readonly body: unknown }[];
  /** Тела запросов к одному RPC. */
  bodies: (rpc: string) => unknown[];
}

function decode(body: unknown, headers: HeadersInit | undefined): unknown {
  if (typeof body === 'string') return decodeConnectBody(body, null);
  // isView, а не instanceof Uint8Array: в jsdom этот класс «чужой» (другой realm).
  if (ArrayBuffer.isView(body)) {
    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    return decodeConnectBody(bytes, new Headers(headers).get('Content-Type'));
  }
  return null;
}

/**
 * Подменяет глобальный fetch ядром-заглушкой. Нет маршрута — ответ `{}`.
 * Ответ-стрим для server-stream RPC: `routes['LogService/Subscribe'] = new StreamReply([...])`.
 */
export function stubCore(routes: Record<string, Route>): CoreStub {
  const calls: CoreStub['calls'][number][] = [];
  const counts = new Map<string, number>();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      // …/lavray.v1.CoreService/Connect → CoreService/Connect
      const rpc = url.split('/').slice(-2).join('/').replace(/^lavray\.v1\./, '');
      const body = decode(init?.body, init?.headers);
      calls.push({ rpc, body });
      const n = counts.get(rpc) ?? 0;
      counts.set(rpc, n + 1);
      const route = routes[rpc] ?? {};
      const reply = isRouteFn(route) ? route(n, body) : route;
      if (reply instanceof Down) return Promise.reject(new TypeError('Failed to fetch'));
      // Server-stream: кадры application/connect+json, abort обрывает чтение (streamStub.ts).
      if (reply instanceof StreamReply) return streamFetch(reply, init?.signal);
      const failed = reply instanceof Failure;
      return Promise.resolve(
        new Response(JSON.stringify(failed ? { code: reply.code, message: reply.message } : reply), {
          status: failed ? 500 : 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
  return { routes, calls, bodies: (rpc) => calls.filter((c) => c.rpc === rpc).map((c) => c.body) };
}

/** jsdom не реализует matchMedia, а App читает его при старте. */
export function stubMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  });
}

export interface Mounted {
  readonly container: HTMLDivElement;
  /** Идемпотентно. */
  readonly unmount: () => void;
}

const mounted = new Set<Mounted>();

/** Размонтирует всё смонтированное (afterEach): упавший тест не оставляет слушателей на window. */
export function unmountAll(): void {
  for (const handle of [...mounted]) handle.unmount();
}

/** Ждёт ms миллисекунд внутри act: срабатывают таймеры и асинхронные эффекты. */
export async function flush(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  });
}

/** Монтирует элемент как есть (App сам создаёт клиентов) и ждёт первые эффекты. */
export async function mountBare(element: ReactElement): Promise<Mounted> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const handle: Mounted = {
    container,
    unmount: (): void => {
      if (!mounted.delete(handle)) return;
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
  mounted.add(handle);
  await act(async () => {
    root.render(element);
    await Promise.resolve();
  });
  await flush();
  return handle;
}

/** Монтирует экран с клиентами ядра (их запросы идут в stubCore). */
export function mount(element: ReactElement): Promise<Mounted> {
  const clients = createCoreClients('http://127.0.0.1:1');
  return mountBare(createElement(CoreContext.Provider, { value: clients }, element));
}

/** Клик внутри act + пауза на асинхронные обработчики. */
export async function click(el: Element | null | undefined): Promise<void> {
  if (el === null || el === undefined) throw new Error('click: элемент не найден');
  await act(async () => {
    (el as HTMLElement).click();
    await Promise.resolve();
  });
  await flush(20);
}
