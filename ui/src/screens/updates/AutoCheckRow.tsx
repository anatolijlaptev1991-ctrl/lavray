// SPDX-License-Identifier: GPL-3.0-only

// AutoCheckRow.tsx — переключатель фоновой проверки обновлений (T-75,
// настройка `update.auto_check`, по умолчанию включено). Доступное имя —
// подпись строки; состояние читается скринридером через aria-checked.
import { useId } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';

interface Props {
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
}

export function AutoCheckRow({ checked, onChange }: Props): JSX.Element {
  const { t } = useI18n();
  const labelId = useId();
  const descId = useId();
  return (
    <div className="set-row" id="updAutoRow">
      <div className="set-txt">
        <div className="set-l" id={labelId}>
          {t('upd.autoCheck')}
        </div>
        <div className="set-d" id={descId}>
          {t('upd.autoCheckD')}
        </div>
      </div>
      <div className="set-ctl">
        <button
          className={`sw${checked ? ' on' : ''}`}
          role="switch"
          aria-checked={checked}
          aria-labelledby={labelId}
          aria-describedby={descId}
          onClick={() => {
            onChange(!checked);
          }}
        />
      </div>
    </div>
  );
}
