// core.ts — ConnectRPC-клиент LAVRay-ядра (ui/src/lib). Один транспорт на
// приложение: createConnectTransport (connect-web) на адрес ядра. В нативном
// режиме адрес даёт оболочка (Tauri IPC: localhost-порт named-pipe-моста);
// в веб-режиме — location.origin (панель за той же auth-cookie).
import { createConnectTransport } from '@connectrpc/connect-web';
import { createClient, type Interceptor } from '@connectrpc/connect';
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
  return window.__LAVRAY_CORE_URL ?? 'http://127.0.0.1:0';
}
