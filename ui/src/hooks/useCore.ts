// useCore.ts — React-хуки состояния ядра: клиенты + периодический опрос
// статуса/профилей. Один контекст на приложение (источник — window env или
// адаптер оболочки).
import { createContext, useContext, useEffect, useState } from 'react';
import { create } from '@bufbuild/protobuf';
import type { CoreClients } from '../lib/core';
import { createCoreClients, coreUrlFromEnv, friendlyCoreError } from '../lib/core';
import type { CoreStatus, Profile } from '../gen/lavray_pb';
import { CoreState, CoreStatusSchema } from '../gen/lavray_pb';

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

// Полный снимок статуса ядра (proto CoreStatus): нужен UI для таймера
// сессии (started_at_ms), режима, имени активного профиля и версии.
export type { CoreStatus };

function initialStatus(): CoreStatus {
  return create(CoreStatusSchema, {
    state: CoreState.IDLE,
    activeProfileId: 0n,
    lastError: '',
  });
}

/** Опрос статуса ядра раз в секунду (дешёвый unary RPC). */
export function useCoreStatus(): CoreStatus {
  const core = useCore();
  const [status, setStatus] = useState<CoreStatus>(initialStatus);
  useEffect(() => {
    const tick = async (): Promise<void> => {
      try {
        const st = await core.core.getStatus({});
        // D9/D15 (аудит round 2): раньше хук выкидывал started_at_ms, mode,
        // имя профиля и версию ядра — таймер сессии сбрасывался, а причина
        // падения нигде не показывалась. Теперь статус передаётся целиком.
        setStatus(st);
      } catch (e) {
        setStatus((prev) =>
          create(CoreStatusSchema, { ...prev, lastError: friendlyCoreError(e) }),
        );
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
