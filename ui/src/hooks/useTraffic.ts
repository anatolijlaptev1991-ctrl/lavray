// useTraffic.ts — суммарная скорость сессии для статус-бара.
// Источник тот же, что у графика (StatsService.Subscribe): поток отдаёт
// bps по каждому тегу; для статус-бара нужна только сумма.
import { useEffect, useState } from 'react';
import { useCore } from './useCore';

export interface Speed {
  readonly down: number;
  readonly up: number;
}

export function useTrafficSpeed(active: boolean): Speed {
  const core = useCore();
  const [speed, setSpeed] = useState<Speed>({ down: 0, up: 0 });

  useEffect(() => {
    if (!active) {
      setSpeed({ down: 0, up: 0 });
      return undefined;
    }
    const ac = new AbortController();
    void (async (): Promise<void> => {
      try {
        const stream = core.stats.subscribe({ intervalMs: 1000 }, { signal: ac.signal });
        for await (const snap of stream) {
          let down = 0;
          let up = 0;
          for (const tag of snap.tags) {
            down += tag.downlinkBps;
            up += tag.uplinkBps;
          }
          setSpeed({ down, up });
        }
      } catch {
        /* ядро отключилось — нули останутся */
      }
    })();
    return (): void => {
      ac.abort();
    };
  }, [active, core]);

  return speed;
}
