// SPDX-License-Identifier: GPL-3.0-only

// UpdatesHeader.tsx — шапка «Центра обновлений» (T-75): заголовок, «последняя
// проверка», выбор канала и «Проверить сейчас»; на бете — предупреждение о ней.
import type { JSX } from 'react';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../hooks/useI18n';
import type { UpdateFlowApi } from '../../hooks/useUpdateFlow';
import { canCheck } from '../../lib/updates/flowReducer';
import type { Channel } from '../../lib/updates/types';
import { ChannelSelect } from './ChannelSelect';
import { LastCheckedLine } from './LastCheckedLine';

interface Props {
  readonly flow: UpdateFlowApi;
  readonly channel: Channel;
  readonly onChannel: (next: Channel) => void;
  /** Время последней успешной проверки (мс), 0 — не было. */
  readonly lastCheckedAtMs: number;
}

export function UpdatesHeader({ flow, channel, onChannel, lastCheckedAtMs }: Props): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="card">
      <div className="card-h">
        <span className="ic">
          <Icon name="refresh" />
        </span>
        <h2>{t('updates.title')}</h2>
        <span className="flex1" />
        <LastCheckedLine lastCheckedAtMs={lastCheckedAtMs} />
      </div>
      <div className="srv-import-row" style={{ flexWrap: 'wrap' }}>
        <ChannelSelect channel={channel} onChange={onChannel} />
        <button className="btn btn-pri btn-sm" disabled={!canCheck(flow.state)} onClick={flow.check}>
          {flow.state.kind === 'checking' ? t('upd.checking') : t('upd.checkNow')}
        </button>
      </div>
      {channel === 'beta' && (
        <div className="infoblock" style={{ marginTop: 12 }}>
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="t">
            <b>{t('upd.beta')}</b>
            <span>{t('upd.betaD')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
