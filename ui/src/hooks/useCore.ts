// SPDX-License-Identifier: GPL-3.0-only

// useCore.ts — React-хуки состояния ядра: клиенты + периодический опрос
// статуса/профилей. Один контекст на приложение (источник — window env или
// адаптер оболочки).
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { CoreClients } from '../lib/core';
import { createCoreClients } from '../lib/core';
import { coreStatusStore } from '../lib/coreStatusStore';
import { getCoreEndpoint, subscribeCoreEndpoint } from '../lib/coreEndpoint';
import { getCsrfToken, isWebShell } from '../lib/webSession';
import type { CoreStatus, Profile } from '../gen/lavray_pb';

export const CoreContext = createContext<CoreClients | null>(null);

export function useCore(): CoreClients {
  const clients = useContext(CoreContext);
  if (clients === null) throw new Error('CoreContext не смонтирован');
  return clients;
}

/**
 * Клиенты ядра для приложения. Пересоздаются, когда оболочка сообщает новый
 * адрес или токен (после перезапуска ядра, T-03); страница не перезагружается.
 */
export function useCoreClients(): CoreClients {
  // Третий аргумент — снимок для сервера (renderToString), как в useI18n и useSystemProxy.
  const { url, token } = useSyncExternalStore(subscribeCoreEndpoint, getCoreEndpoint, getCoreEndpoint);
  // Веб-панель: без токена оболочки клиенты ходят с cookie сессии и CSRF-заголовком.
  const cookie = useMemo(() => isWebShell(), []) && token === '';
  return useMemo(
    () =>
      createCoreClients(url, cookie ? { mode: 'cookie', csrf: getCsrfToken } : token === '' ? {} : { token }),
    [url, token, cookie],
  );
}

// Полный снимок статуса ядра (proto CoreStatus): нужен UI для таймера
// сессии (started_at_ms), режима, имени активного профиля и версии.
export type { CoreStatus };

/** Статус ядра: общий для всех потребителей, опрос один (lib/coreStatusStore.ts). */
export function useCoreStatus(): CoreStatus {
  const store = coreStatusStore(useCore());
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Профили (с поиском на стороне ядра). */
export function useProfiles(search: string): {
  profiles: Profile[];
  total: bigint;
  refresh: () => void;
} {
  const core = useCore();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [total, setTotal] = useState<bigint>(0n);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const req = search === '' ? {} : { search };
        const res = await core.profiles.listProfiles(req);
        setProfiles(res.profiles);
        setTotal(res.total);
      } catch {
        /* offline */
      }
    })();
    return (): void => {
      /* unmount: setState в React 18 — no-op */
    };
  }, [core, search, nonce]);
  const refresh = (): void => {
    setNonce((n) => n + 1);
  };
  return { profiles, total, refresh };
}
