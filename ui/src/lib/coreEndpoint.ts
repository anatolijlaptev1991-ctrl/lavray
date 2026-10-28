// coreEndpoint.ts — адрес и токен ядра, которые оболочка (Tauri) меняет во
// время работы. После падения ядра надзиратель оболочки поднимает его заново
// на НОВОМ порту с НОВЫМ токеном и шлёт событие `core-endpoint` {url, token};
// при смерти ядра приходит {url: '', token: ''} (T-03). Источник истины —
// window.__LAVRAY_CORE_URL/TOKEN (их выставляют и dev-режим, и тесты); здесь
// добавлена подписка, чтобы клиенты ядра пересоздавались без перезагрузки.
import { coreUrlFromEnv } from './core';

/** Имя события оболочки (shell/src/endpoint.rs: CORE_ENDPOINT_EVENT). */
export const CORE_ENDPOINT_EVENT = 'core-endpoint';
/** Сколько первый рендер ждёт адрес ядра; дальше адрес подхватится сам. */
export const FIRST_ENDPOINT_WAIT_MS = 3000;

export interface CoreEndpoint {
  readonly url: string;
  readonly token: string;
}

const listeners = new Set<() => void>();

function readEndpoint(): CoreEndpoint {
  return { url: coreUrlFromEnv(), token: window.__LAVRAY_CORE_TOKEN ?? '' };
}

let last: CoreEndpoint = readEndpoint();

/** Текущий адрес; тот же объект, пока адрес и токен не менялись. */
export function getCoreEndpoint(): CoreEndpoint {
  const now = readEndpoint();
  if (now.url !== last.url || now.token !== last.token) last = now;
  return last;
}

export function subscribeCoreEndpoint(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

/** 'tcp://127.0.0.1:5' и '127.0.0.1:5' → 'http://127.0.0.1:5'; '' → ''. */
export function shellUrlToHttp(url: string): string {
  return url === '' ? '' : 'http://' + url.replace(/^tcp:\/\//, '');
}

/** Принять адрес от оболочки; пустой url = «ядра нет». */
export function setCoreEndpoint(shellUrl: string, token: string): void {
  if (shellUrl === '') {
    delete window.__LAVRAY_CORE_URL;
    delete window.__LAVRAY_CORE_TOKEN;
  } else {
    window.__LAVRAY_CORE_URL = shellUrlToHttp(shellUrl);
    window.__LAVRAY_CORE_TOKEN = token;
  }
  const before = last;
  if (getCoreEndpoint() !== before) {
    listeners.forEach((listener) => {
      listener();
    });
  }
}

/**
 * Следить за адресом ядра в окне Tauri: подписка на событие `core-endpoint` и
 * команда `core_endpoint` (оболочка отвечает, когда ядро готово). Событие
 * новее ответа команды: пришло раньше — ответ отбрасывается. Промис
 * разрешается, когда пришёл первый ответ оболочки (или она недоступна).
 */
export async function followShellEndpoint(): Promise<void> {
  try {
    const [{ invoke }, { listen }] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
    ]);
    const seen = { event: false };
    await listen<CoreEndpoint>(CORE_ENDPOINT_EVENT, (event) => {
      seen.event = true;
      setCoreEndpoint(event.payload.url, event.payload.token);
    });
    const [url, token] = await invoke<[string, string]>('core_endpoint');
    if (!seen.event) setCoreEndpoint(url, token);
  } catch {
    /* оболочка недоступна — UI покажет «Отключено» */
  }
}
