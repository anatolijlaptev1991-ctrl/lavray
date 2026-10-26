// useCore.ts — React-хуки состояния ядра: клиенты + периодический опрос
// статуса/профилей. Один контекст на приложение (источник — window env или
// адаптер оболочки).
import { createContext, useContext, useEffect, useState } from 'react';
import type { CoreClients } from '../lib/core';
import { createCoreClients, coreUrlFromEnv } from '../lib/core';
import type { Profile } from '../gen/lavray_pb';
import { CoreState } from '../gen/lavray_pb';

export const CoreContext = createContext<CoreClients | null>(null);

export function useCore(): CoreClients {
  const clients = useContext(CoreContext);
  if (clients === null) throw new Error('CoreContext не смонтирован');
  return clients;
}

/** Клиенты один раз на приложение (baseUrl/token из окружения оболочки). */
export function useCoreClients(): CoreClients {
  const [clients] = useState<CoreClients>(() => {
    const token = window.__LAVRAY_CORE_TOKEN;
    return createCoreClients(coreUrlFromEnv(), token === undefined ? {} : { token });
  });
  return clients;
}

export interface CoreStatus {
  state: CoreState;
  activeProfileId: bigint;
  lastError: string;
}

/** Опрос статуса ядра раз в секунду (дешёвый unary RPC). */
export function useCoreStatus(): CoreStatus {
  const core = useCore();
  const [status, setStatus] = useState<CoreStatus>({
    state: CoreState.IDLE,
    activeProfileId: 0n,
    lastError: '',
  });
  useEffect(() => {
    const tick = async (): Promise<void> => {
      try {
        const st = await core.core.getStatus({});
        setStatus({
          state: st.state,
          activeProfileId: st.activeProfileId ?? 0n,
          lastError: st.lastError ?? '',
        });
      } catch {
        /* ядро недоступно — оставляем прежнее состояние */
      }
    };
    void tick();
    const id = setInterval(() => {
      void tick();
    }, 1000);
    return (): void => {
      clearInterval(id);
    };
  }, [core]);
  return status;
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
