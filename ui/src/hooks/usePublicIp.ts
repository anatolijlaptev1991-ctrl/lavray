// SPDX-License-Identifier: GPL-3.0-only

// usePublicIp.ts — внешний IP через туннель для правой панели «Подключение»
// (GetPublicIp, THROUGH_TUNNEL). Запрос уходит один раз после подключения; ответ
// держится 5 минут и привязан к сеансу (сервер + момент запуска): после
// переподключения кэш недействителен. «Обновить» всегда спрашивает ядро.
import { useCallback, useEffect, useRef, useState } from 'react';
import { GetPublicIpRequest_Via } from '../gen/lavray_pb';
import { showCoreError } from '../lib/core';
import { useCore } from './useCore';
import { useI18n } from './useI18n';

/** Сколько живёт найденный IP, мс. */
export const PUBLIC_IP_TTL_MS = 5 * 60_000;

interface Cached {
  readonly session: string;
  readonly ip: string;
  readonly at: number;
}

let cache: Cached | null = null;

/** Сбросить кэш (тесты и выход из сеанса). */
export function resetPublicIpCache(): void {
  cache = null;
}

export interface PublicIp {
  /** Найденный IP; null — ещё не определён или не подключено. */
  readonly ip: string | null;
  readonly busy: boolean;
  /** Текст ошибки для пользователя; '' — ошибки нет. */
  readonly error: string;
  /** Спросить ядро заново, минуя кэш. */
  readonly refresh: () => void;
}

export function usePublicIp(connected: boolean, session: string, now: () => number = Date.now): PublicIp {
  const core = useCore();
  const { t } = useI18n();
  const [ip, setIp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ticket = useRef(0);

  const load = useCallback(
    async (force: boolean): Promise<void> => {
      const hit = cache;
      if (!force && hit?.session === session && now() - hit.at < PUBLIC_IP_TTL_MS) {
        setIp(hit.ip);
        setError('');
        return;
      }
      const mine = (ticket.current += 1);
      setBusy(true);
      setError('');
      try {
        const res = await core.diagnostics.getPublicIp({ via: GetPublicIpRequest_Via.THROUGH_TUNNEL });
        if (mine !== ticket.current) return; // устарел: сменился сеанс или отключились
        const found = res.ip ?? '';
        if (found === '') throw new Error('empty ip');
        cache = { session, ip: found, at: now() };
        setIp(found);
      } catch (e) {
        if (mine === ticket.current) setError(showCoreError(e, t));
      } finally {
        if (mine === ticket.current) setBusy(false);
      }
    },
    [core, session, t, now],
  );

  useEffect(() => {
    if (connected) {
      void load(false);
      return;
    }
    ticket.current += 1; // отключились: ответ в пути больше не нужен
    setIp(null);
    setBusy(false);
    setError('');
  }, [connected, load]);

  const refresh = useCallback((): void => {
    void load(true);
  }, [load]);
  return { ip, busy, error, refresh };
}
