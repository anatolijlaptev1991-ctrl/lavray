// SPDX-License-Identifier: GPL-3.0-only

// ConnsToolbar.tsx — панель экрана «Соединения»: чипы «Все / Прокси / Напрямую /
// Блок» (aria-pressed), поиск, счётчики, пауза и метка «показаны только новейшие».
import type { JSX } from 'react';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../hooks/useI18n';
import { CONN_CHIPS } from '../../lib/conns/filter';
import type { ConnChip } from '../../lib/conns/filter';
import { ACTIVE_PAGE_LIMIT } from '../../lib/conns/model';
import type { MessageKey } from '../../lib/i18n';

const CHIP_LABEL: Readonly<Record<ConnChip, MessageKey>> = {
  all: 'conns.chip.all',
  proxy: 'conns.chip.proxy',
  direct: 'conns.chip.direct',
  block: 'conns.chip.block',
};

export interface ConnsToolbarProps {
  readonly chip: ConnChip;
  readonly onChip: (chip: ConnChip) => void;
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly activeCount: number;
  readonly closedCount: number;
  readonly truncated: boolean;
  readonly paused: boolean;
  readonly onPause: (paused: boolean) => void;
}

function ChipGroup({ chip, onChip }: Pick<ConnsToolbarProps, 'chip' | 'onChip'>): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="chips" role="group" aria-label={t('conns.filter')}>
      {CONN_CHIPS.map((c) => (
        <button
          key={c}
          type="button"
          className={`chip${chip === c ? ' on' : ''}`}
          aria-pressed={chip === c}
          onClick={() => {
            onChip(c);
          }}
        >
          {t(CHIP_LABEL[c])}
        </button>
      ))}
    </div>
  );
}

export function ConnsToolbar(p: ConnsToolbarProps): JSX.Element {
  const { t, tf } = useI18n();
  return (
    <div className="log-toolbar">
      <ChipGroup chip={p.chip} onChip={p.onChip} />
      <div className="searchwrap">
        <input
          className="input"
          type="search"
          placeholder={t('conns.search')}
          aria-label={t('conns.search')}
          value={p.query}
          onChange={(e) => {
            p.onQuery(e.target.value);
          }}
        />
      </div>
      <span className="cap" aria-live="polite">
        {tf('conns.count', { n: p.activeCount })} · {tf('conns.countClosed', { n: p.closedCount })}
      </span>
      {p.truncated && (
        <span className="badge badge-warn">{tf('conns.truncated', { n: ACTIVE_PAGE_LIMIT })}</span>
      )}
      <span className="flex1" />
      {p.paused && <span className="badge badge-info">{t('conns.paused')}</span>}
      <button
        type="button"
        className={`btn btn-sm ${p.paused ? 'btn-sec' : 'btn-ghost'}`}
        onClick={() => {
          p.onPause(!p.paused);
        }}
      >
        <Icon name={p.paused ? 'play' : 'pause'} />
        <span>{p.paused ? t('log.resume') : t('log.pause')}</span>
      </button>
    </div>
  );
}
