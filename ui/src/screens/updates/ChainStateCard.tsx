// SPDX-License-Identifier: GPL-3.0-only

// ChainStateCard.tsx — состояние цепочки доверия (T-75): версия корня и
// максимальные serial по каналам. Диагностика для «подробностей»; без данных
// карточки нет.
import type { JSX } from 'react';
import { Icon } from '../../components/Icon';
import type { ChainStateInfo } from '../../gen/lavray_pb';
import { useI18n } from '../../hooks/useI18n';

export function ChainStateCard({ chain }: { readonly chain: ChainStateInfo | null }): JSX.Element | null {
  const { t } = useI18n();
  if (chain === null) return null;
  return (
    <div className="card">
      <div className="card-h">
        <span className="ic">
          <Icon name="shield" />
        </span>
        <h2>{t('upd.stage.verify')}</h2>
      </div>
      <div className="sub-meta">
        <div className="row">
          <span className="k">root</span>
          <span className="mono">v{String(chain.rootVersion)}</span>
        </div>
        {Object.entries(chain.maxSerial).map(([channel, serial]) => (
          <div className="row" key={channel}>
            <span className="k">{channel}</span>
            <span className="mono">serial {String(serial)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
