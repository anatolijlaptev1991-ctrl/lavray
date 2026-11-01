// SPDX-License-Identifier: GPL-3.0-only

// ChannelSelect.tsx — выбор канала обновлений stable / beta (T-75). Переход на
// бету требует подтверждения (UPDATE-SYSTEM §9): до ответа канал остаётся прежним,
// отказ ничего не меняет. Возврат на stable — без вопросов.
import { useId, useState } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import type { Channel } from '../../lib/updates/types';
import { UpdateConfirm } from './UpdateConfirm';

interface Props {
  /** Сохранённый канал. */
  readonly channel: Channel;
  /** Записать канал; ответ не ждём — ошибку записи показывает экран. */
  readonly onChange: (next: Channel) => void;
  readonly disabled?: boolean;
}

export function ChannelSelect({ channel, onChange, disabled = false }: Props): JSX.Element {
  const { t } = useI18n();
  const id = useId();
  const [askBeta, setAskBeta] = useState(false);

  const pick = (value: string): void => {
    if (value === 'beta' && channel !== 'beta') setAskBeta(true);
    else if (value === 'stable' && channel !== 'stable') onChange('stable');
  };

  return (
    <>
      <label className="cap" htmlFor={id}>
        {t('upd.channel')}
      </label>
      <select
        id={id}
        className="select"
        style={{ width: 'auto' }}
        value={channel}
        disabled={disabled}
        onChange={(e) => {
          pick(e.target.value);
        }}
      >
        <option value="stable">{t('upd.stable')}</option>
        <option value="beta">{t('upd.beta')}</option>
      </select>
      {askBeta && (
        <UpdateConfirm
          titleId="updBetaTitle"
          title={t('upd.betaT')}
          text={t('upd.betaD')}
          confirmLabel={t('upd.betaOk')}
          onConfirm={() => {
            setAskBeta(false);
            onChange('beta');
          }}
          onCancel={() => {
            setAskBeta(false);
          }}
        />
      )}
    </>
  );
}
