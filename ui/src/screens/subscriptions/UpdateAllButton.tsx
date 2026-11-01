// SPDX-License-Identifier: GPL-3.0-only

// UpdateAllButton.tsx — «Обновить все» (UpdateAllSubscriptions): ядро обновляет
// подписки по очереди и шлёт кадры прогресса. Кадр CONFIRM_REQUIRED означает, что
// обновление хочет удалить серверы и ждёт решения: такие подписки не трогаются и
// называются в итоге, подтверждать их нужно по одной (кнопкой «Обновить» карточки).
import { useState } from 'react';
import type { JSX } from 'react';
import { Icon } from '../../components/Icon';
import { useCore } from '../../hooks/useCore';
import { useI18n } from '../../hooks/useI18n';
import { showCoreError } from '../../lib/core';
import { tallyPhase } from './updateAllTally';
import type { UpdateAllTally } from './updateAllTally';

interface Props {
  /** Нет подписок — кнопка недоступна. */
  readonly disabled: boolean;
  /** Прогон закончился: текст итога; экран перечитывает список. */
  readonly onFinished: (text: string) => void;
  readonly onError: (text: string) => void;
  /** Идёт ли другое обновление (кнопка одной карточки). */
  readonly otherBusy: boolean;
}

export function UpdateAllButton({ disabled, onFinished, onError, otherBusy }: Props): JSX.Element {
  const { t, tf } = useI18n();
  const core = useCore();
  const [busy, setBusy] = useState(false);

  const run = async (): Promise<void> => {
    onError('');
    setBusy(true);
    let tally: UpdateAllTally = { ok: 0, skip: 0, fail: 0, confirm: 0 };
    try {
      for await (const ev of core.subscriptions.updateAllSubscriptions({})) {
        tally = tallyPhase(tally, ev.phase);
      }
      const text = tf('subs.updateAll.done', { ok: tally.ok, skip: tally.skip, fail: tally.fail });
      onFinished(tally.confirm > 0 ? `${text}. ${tf('subs.updateAll.confirm', { n: tally.confirm })}` : text);
    } catch (e) {
      onError(showCoreError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className={`btn btn-sec${busy ? ' loading' : ''}`}
      disabled={disabled || busy || otherBusy}
      aria-busy={busy}
      onClick={() => void run()}
    >
      <Icon name="refresh" />
      <span>{busy ? t('subs.updateAll.busy') : t('subs.updateAll')}</span>
    </button>
  );
}
