// Регрессия T-03 (A2-01, A2-02, B1-16, D2-09): настоящий main.tsx + App.
// Оболочка перезапускает ядро — сначала шлёт «ядра нет», затем новый порт и
// новый токен. Раньше UI читал core_endpoint один раз, продолжал слать
// запросы на мёртвый порт и до перезапуска приложения показывал «Подключено».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: { payload: { url: string; token: string } }) => void;

const shell = vi.hoisted(() => ({ handler: undefined as undefined | Handler }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string): Promise<unknown> => {
    if (cmd === 'core_endpoint') return Promise.resolve(['127.0.0.1:50001', 'tokenA']);
    if (cmd === 'window_is_maximized') return Promise.resolve(false);
    return Promise.resolve(null);
  },
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: Handler): Promise<() => void> => {
    // T-45: слушателей несколько (core-endpoint, tray-action); тест шлёт только core-endpoint.
    if (name === 'core-endpoint') shell.handler = handler;
    return Promise.resolve((): void => undefined);
  },
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: (): { onResized: () => Promise<() => void> } => ({
    onResized: (): Promise<() => void> => Promise.resolve((): void => undefined),
  }),
}));

interface Hit {
  port: string;
  auth: string | null;
}
const hits: Hit[] = [];
let deadPort = '';

/** Ядро №1 (:50001, tokenA) подключено, ядро №2 (:50002, tokenB) простаивает. */
function installFetch(): void {
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { port, pathname } = new URL(url);
    const auth = new Headers(init?.headers).get('authorization');
    hits.push({ port, auth });
    if (port === deadPort) return Promise.reject(new TypeError('Failed to fetch'));
    const json = { 'content-type': 'application/json' };
    const known = (port === '50001' && auth === 'Bearer tokenA') || (port === '50002' && auth === 'Bearer tokenB');
    if (!known) return Promise.resolve(new Response('{"code":"unauthenticated"}', { status: 401, headers: json }));
    const body = pathname.endsWith('.CoreService/GetStatus')
      ? { state: port === '50001' ? 'CORE_STATE_CONNECTED' : 'CORE_STATE_IDLE', coreVersion: '1.14.1-lav.1' }
      : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: json }));
  };
}

const label = (): string => document.querySelector('#connState')?.textContent ?? '';

// Приложение запущено через main.tsx и не размонтируется: опросы, начатые в
// тесте, останавливаем сами, иначе они стреляют после сноса окружения.
const intervals: ReturnType<typeof setInterval>[] = [];
const realSetInterval = globalThis.setInterval;

describe('оболочка перезапустила ядро: новый порт и токен', () => {
  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList,
    );
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    window.localStorage.clear();
    window.localStorage.setItem('lavray.onboarded', '1');
    window.localStorage.setItem('lavray.lang', 'en');
    document.body.innerHTML = '<div id="root"></div>';
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((...args: Parameters<typeof setInterval>) => {
      const id = realSetInterval(...args);
      intervals.push(id);
      return id;
    }) as typeof setInterval);
    installFetch();
  });
  afterEach(() => {
    intervals.splice(0).forEach((id) => {
      clearInterval(id);
    });
    vi.restoreAllMocks();
  });

  it('UI говорит с новым ядром и не держит «Подключено» от старого', async () => {
    await import('./main'); // bootstrap(): core_endpoint -> первый рендер
    await vi.waitFor(() => {
      expect(label()).toBe('Connected');
    });
    expect(hits.some((h) => h.port === '50001' && h.auth === 'Bearer tokenA')).toBe(true);

    // ядро №1 убито: оболочка сообщает, что ядра нет
    deadPort = '50001';
    shell.handler?.({ payload: { url: '', token: '' } });
    await vi.waitFor(() => {
      expect(label()).toBe('Disconnected');
    });

    // оболочка подняла ядро №2 на другом порту с другим токеном
    const mark = hits.length;
    shell.handler?.({ payload: { url: 'tcp://127.0.0.1:50002', token: 'tokenB' } });
    await vi.waitFor(() => {
      expect(hits.slice(mark).some((h) => h.port === '50002' && h.auth === 'Bearer tokenB')).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 1300)); // ещё один период опроса

    const after = hits.slice(mark);
    expect(after.filter((h) => h.port === '50001'), 'на мёртвый порт больше не ходим').toEqual([]);
    expect(after.filter((h) => h.port === '50002' && h.auth !== 'Bearer tokenB'), 'старый токен не уходит').toEqual([]);
    expect(label()).toBe('Disconnected');
  }, 20000);
});
