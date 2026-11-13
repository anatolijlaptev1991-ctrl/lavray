// SPDX-License-Identifier: GPL-3.0-only

// MotionRow.tsx — строка «Анимации» в «Оформлении»: Полные / Экономные /
// Выключены (lib/motion.ts). Применяется сразу, без перезапуска.
import { useState } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { chooseMotion, MOTIONS, resolveMotion } from '../../lib/motion';
import type { MotionPreference } from '../../lib/motion';

export function MotionRow(): JSX.Element {
  const { t } = useI18n();
  const [mode, setMode] = useState<MotionPreference>(() => resolveMotion(window.localStorage, window));
  return (
    <div className="set-row" id="motionRow">
      <div className="set-txt">
        <div className="set-l">{t('set.motion')}</div>
        <div className="set-d">{t('set.motionD')}</div>
      </div>
      <div className="set-ctl">
        <div className="seg" role="group" aria-label={t('set.motion')}>
          {MOTIONS.map((m) => (
            <button
              key={m}
              className={mode === m ? 'on' : ''}
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                chooseMotion(window, m);
              }}
            >
              {t(`motion.${m}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
