// core.ts — ConnectRPC-клиент LAVRay-ядра (ui/src/lib). Один транспорт на
// приложение: createConnectTransport (connect-web) на адрес ядра. В нативном
// режиме адрес даёт оболочка (Tauri IPC: localhost-порт named-pipe-моста);
// в веб-режиме — location.origin (панель за той же auth-cookie).
import { createConnectTransport } from '@connectrpc/connect-web';
import { Code, ConnectError, createClient, type Interceptor } from '@connectrpc/connect';
import {
  CoreService,
  ProfileService,
  SubscriptionService,
  RoutingService,
  DnsService,
  SettingsService,
  LogService,
  StatsService,
  ConnectionService,
  DiagnosticsService,
  UpdateService,
} from '../gen/lavray_pb';
import { t as translate } from './i18n';

export interface CoreAuth {
  token?: string; // Bearer (натив: сгенерирован оболочкой; веб: cookie-сессия)
}

// createCoreClients — клиенты всех сервисов поверх одного транспорта.
export interface CoreClients {
  transport: ReturnType<typeof createConnectTransport>;
  core: ReturnType<typeof createClient<typeof CoreService>>;
  profiles: ReturnType<typeof createClient<typeof ProfileService>>;
  subscriptions: ReturnType<typeof createClient<typeof SubscriptionService>>;
  routing: ReturnType<typeof createClient<typeof RoutingService>>;
  dns: ReturnType<typeof createClient<typeof DnsService>>;
  settings: ReturnType<typeof createClient<typeof SettingsService>>;
  logs: ReturnType<typeof createClient<typeof LogService>>;
  stats: ReturnType<typeof createClient<typeof StatsService>>;
  connections: ReturnType<typeof createClient<typeof ConnectionService>>;
  diagnostics: ReturnType<typeof createClient<typeof DiagnosticsService>>;
  updates: ReturnType<typeof createClient<typeof UpdateService>>;
}

export function createCoreClients(baseUrl: string, auth?: CoreAuth): CoreClients {
  // Bearer-токен через interceptor (в connect-web v2 headers-опции нет).
  const token = auth?.token ?? '';
  const authInterceptor: Interceptor | undefined = token
    ? (next) => async (req) => {
        req.header.set('Authorization', `Bearer ${token}`);
        return next(req);
      }
    : undefined;
  const interceptors: Interceptor[] = authInterceptor ? [authInterceptor] : [];
  // JSON-кодек: веб-панель/тесты без binary; ядро принимает оба формата.
  const transport = createConnectTransport({ baseUrl, interceptors, useBinaryFormat: false });
  const c = <T extends Parameters<typeof createClient>[0]>(svc: T): ReturnType<typeof createClient<T>> =>
    createClient(svc, transport);
  return {
    transport,
    core: c(CoreService),
    profiles: c(ProfileService),
    subscriptions: c(SubscriptionService),
    routing: c(RoutingService),
    dns: c(DnsService),
    settings: c(SettingsService),
    logs: c(LogService),
    stats: c(StatsService),
    connections: c(ConnectionService),
    diagnostics: c(DiagnosticsService),
    updates: c(UpdateService),
  };
}

// window.__LAVRAY_CORE_URL — точка интеграции с оболочкой (Tauri подставит
// адрес при старте; dev-режим — прямой localhost).
declare global {
  interface Window {
    __LAVRAY_CORE_URL?: string;
    __LAVRAY_CORE_TOKEN?: string;
  }
}

export function coreUrlFromEnv(): string {
  // Нативно: оболочка выставила адрес (main.tsx → core_endpoint).
  if (window.__LAVRAY_CORE_URL !== undefined) return window.__LAVRAY_CORE_URL;
  // Tauri на Windows отдаёт страницу с origin http://tauri.localhost —
  // это НЕ веб-режим. Без этой проверки UI слал RPC в собственный
  // asset-сервер и получал «unsupported content type: text/html»
  // (реальный дефект, пойман визуальной проверкой релизной сборки).
  const host = window.location.hostname;
  const isTauriShell = host === 'tauri.localhost' || window.location.protocol === 'tauri:';
  if (!isTauriShell && window.location.protocol.startsWith('http')) {
    return window.location.origin;
  }
  // Ядро ещё не сообщило адрес: явный маркер, чтобы ошибка была понятной.
  return 'http://127.0.0.1:0';
}

/** Стабильный код «ядро недоступно» (ключ словаря). Показывать пользователю его нельзя. */
export const CORE_UNAVAILABLE = 'core.unavailable';

/** Ключи словаря, которые friendlyCoreError подставляет сам (T-59). */
export type CoreErrorKey = 'core.unavailable' | 'err.unimplemented' | 'err.precondition';
export type CoreErrorTranslate = (key: CoreErrorKey) => string;

// Сбой самого транспорта: сеть недоступна либо вместо ядра ответил чужой
// сервер (asset-сервер оболочки отвечает HTML с кодом 404/405, прокси — 5xx).
const TRANSPORT_DOWN = /(Failed to fetch|NetworkError|fetch failed|Load failed|^HTTP (404|405|5\d\d)\b)/i;

/**
 * Текст ошибки для пользователя. Всегда возвращает готовую фразу на языке
 * интерфейса, а не ключ словаря:
 * - сеть недоступна или ответил не тот сервер — «Ядро недоступно»;
 * - ядро ответило `Unimplemented` — «Функция пока не реализована» (ядро живо,
 *   это заглушка RPC; раньше она маскировалась под «Ядро недоступно»);
 * - `FailedPrecondition` — «Сейчас это действие недоступно» плюс причина от ядра;
 * - прочее — сообщение как есть.
 * `tr` по умолчанию — глобальный перевод текущего языка; экраны передают свой `t`.
 */
export function friendlyCoreError(e: unknown, tr: CoreErrorTranslate = translate): string {
  const connectErr = e instanceof ConnectError ? e : null;
  const msg = e instanceof Error ? e.message : String(e);
  const raw = connectErr?.rawMessage ?? msg;
  if (TRANSPORT_DOWN.test(raw)) return tr('core.unavailable');
  if (connectErr?.code === Code.Unimplemented) return tr('err.unimplemented');
  if (connectErr?.code === Code.FailedPrecondition) {
    const head = tr('err.precondition');
    const reason = raw.trim();
    return reason === '' ? head : `${head}: ${reason}`;
  }
  return msg;
}

/** Прежнее имя для экранов, которые передают свой `t`. */
export const showCoreError: (e: unknown, t: CoreErrorTranslate) => string = friendlyCoreError;
