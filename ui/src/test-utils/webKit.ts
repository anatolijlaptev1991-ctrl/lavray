// SPDX-License-Identifier: GPL-3.0-only

// webKit.ts — помощники тестов веб-панели: ввод в поля React, поиск поля по
// подписи, ответы ядра с заголовками.
import { act } from 'react';
import { vi } from 'vitest';

/** Вводит текст в поле как пользователь (React слушает событие input). */
export function typeInto(el: HTMLInputElement | null, value: string): void {
  if (el === null) throw new Error('typeInto: поле не найдено');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Поле по тексту его <label> (связь for/id — проверка доступности заодно). */
export function fieldByLabel(root: ParentNode, label: string): HTMLInputElement | null {
  const l = Array.from(root.querySelectorAll('label')).find((x) => x.textContent === label);
  if (l === undefined || l.htmlFor === '') return null;
  return root.querySelector<HTMLInputElement>(`[id="${l.htmlFor}"]`);
}

/** Кнопка по тексту. */
export function buttonByText(root: ParentNode, text: string): HTMLButtonElement | null {
  return Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text) ?? null;
}

/** Тело запроса Connect (JSON): строка или байты → объект. */
function parseBody(body: BodyInit | null | undefined): unknown {
  let text: string | null = null;
  if (typeof body === 'string') text = body;
  // isView, а не instanceof Uint8Array: в jsdom этот класс «чужой» (другой realm).
  else if (ArrayBuffer.isView(body)) text = new TextDecoder().decode(body);
  return text === null || text === '' ? null : (JSON.parse(text) as unknown);
}

interface Reply {
  readonly status?: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/**
 * fetch ядра с заголовками и статусом в ответе: «сервис/метод» → ответ или
 * функция (номер вызова, тело, заголовки запроса). Возвращает журнал вызовов.
 */
export function stubWebCore(
  routes: Record<string, Reply | ((n: number, body: unknown, headers: Headers) => Reply)>,
): { calls: { rpc: string; body: unknown; headers: Headers; init: RequestInit | undefined }[] } {
  const calls: { rpc: string; body: unknown; headers: Headers; init: RequestInit | undefined }[] = [];
  const counts = new Map<string, number>();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const rpc = url.split('/').slice(-2).join('/').replace(/^lavray\.v1\./, '');
      const headers = new Headers(init?.headers);
      const body = parseBody(init?.body);
      calls.push({ rpc, body, headers, init });
      const n = counts.get(rpc) ?? 0;
      counts.set(rpc, n + 1);
      const route = routes[rpc] ?? { body: {} };
      const reply = typeof route === 'function' ? route(n, body, headers) : route;
      return Promise.resolve(
        new Response(JSON.stringify(reply.body ?? {}), {
          status: reply.status ?? 200,
          headers: { 'Content-Type': 'application/json', ...reply.headers },
        }),
      );
    }),
  );
  return { calls };
}

export const unauthenticated = (message = 'неверное имя или пароль'): Reply => ({
  status: 401,
  body: { code: 'unauthenticated', message },
});

export const failure = (status: number, code: string, headers?: Record<string, string>): Reply => ({
  status,
  body: { code, message: code },
  ...(headers === undefined ? {} : { headers }),
});
