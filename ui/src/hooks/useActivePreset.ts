// SPDX-License-Identifier: GPL-3.0-only

// useActivePreset.ts — активный набор правил (id, имя, число правил) для карточки
// «Качество связи» экрана «Подключение». Вынесено из screen_connection.tsx.
import { useEffect, useState } from 'react';
import { presetRuleCount } from '../lib/presets';
import { useCore } from './useCore';

export interface ActivePreset {
  readonly id: string;
  readonly displayName: string;
  readonly rules: number;
}

/** null — набор не прочитан (ядро недоступно): карточка покажет «—». */
export function useActivePreset(): ActivePreset | null {
  const core = useCore();
  const [preset, setPreset] = useState<ActivePreset | null>(null);
  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const res = await core.routing.listPresets({});
        const active = res.presets.find((p) => p.id === res.activePresetId);
        if (active === undefined) return;
        setPreset({ id: active.id, displayName: active.displayName, rules: presetRuleCount(active) });
      } catch {
        /* пресеты недоступны — карточка покажет «—» */
      }
    })();
  }, [core]);
  return preset;
}
