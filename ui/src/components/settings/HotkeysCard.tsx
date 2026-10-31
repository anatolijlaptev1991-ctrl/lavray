// SPDX-License-Identifier: GPL-3.0-only

// HotkeysCard.tsx — раздел «Горячие клавиши» в «Настройках»: сочетания внутри
// приложения. Вынесен из screen_settings.tsx (T-82), чтобы раздел рос здесь.
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { useKbdLabel } from '../../hooks/useKbdLabel';
import { Icon } from '../Icon';

/** Список горячих клавиш раздела: [ключ подписи, клавиша]. */
export const HOTKEYS = [
  ['hk.search', 'K'],
  ['hk.toggle', 'D'],
  ['hk.close', 'Esc'],
  ['hk.settings', ','],
] as const;

export interface HotkeysCardProps {
  /** Ссылка на карточку для оглавления и скролл-наблюдения экрана. */
  readonly cardRef: (el: HTMLDivElement | null) => void;
}

export function HotkeysCard({ cardRef }: HotkeysCardProps): JSX.Element {
  const { t } = useI18n();
  const kbd = useKbdLabel();
  return (
    <div className="card set-card" data-sec="hotkeys" ref={cardRef}>
      <h2>
        <span className="ic">
          <Icon name="keyboard" />
        </span>
        <span>{t('sec.hotkeys')}</span>
      </h2>
      <p className="hint">{t('set.hotkeysD')}</p>
      {HOTKEYS.map(([key, keycap]) => (
        <div className="hk-row" key={key}>
          <div className="set-txt">
            <div className="set-l">{t(key)}</div>
          </div>
          <kbd className="kbd">{kbd(keycap)}</kbd>
        </div>
      ))}
    </div>
  );
}
