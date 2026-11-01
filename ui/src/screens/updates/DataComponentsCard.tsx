// SPDX-License-Identifier: GPL-3.0-only

// DataComponentsCard.tsx — «Наборы маршрутов и гео-данные» на экране «Обновления»
// (T-75/7.5). Данные обновляются отдельно от приложения и без перезапуска; ваши
// копии наборов не меняются. Откат спрашивает подтверждение. Работает и в
// веб-панели: оболочка не нужна.
import { useId, useState } from 'react';
import type { JSX } from 'react';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../hooks/useI18n';
import type { UpdateDataApi } from '../../hooks/useUpdateData';
import type { DataKind } from '../../lib/updates/dataComponents';
import { DataComponentRow } from './DataComponentRow';
import { UpdateConfirm } from './UpdateConfirm';

export function DataComponentsCard({ data }: { readonly data: UpdateDataApi }): JSX.Element {
  const { t, tf } = useI18n();
  const titleId = useId();
  const [asking, setAsking] = useState<DataKind | null>(null);
  const name = (kind: DataKind): string => t(kind === 'presets' ? 'upd.comp.presets' : 'upd.comp.geo');
  return (
    <div className="card" data-testid="upd-data" role="group" aria-labelledby={titleId}>
      <div className="card-h">
        <span className="ic">
          <Icon name="route" />
        </span>
        <h2 id={titleId}>{t('upd.comp.title')}</h2>
      </div>
      <p className="cap" style={{ marginBottom: 8 }}>
        {t('upd.comp.hint')}
      </p>
      {data.rows.map((row) => (
        <DataComponentRow
          key={row.kind}
          row={row}
          checked={data.checked}
          busy={data.busy}
          onInstall={() => {
            data.install(row.kind);
          }}
          onRollback={() => {
            setAsking(row.kind);
          }}
        />
      ))}
      {asking !== null && (
        <UpdateConfirm
          titleId="updDataRbTitle"
          title={tf('upd.comp.rbTitle', { name: name(asking) })}
          text={t('upd.comp.rbConfirm')}
          confirmLabel={t('upd.comp.rollback')}
          onConfirm={() => {
            data.rollback(asking);
            setAsking(null);
          }}
          onCancel={() => {
            setAsking(null);
          }}
        />
      )}
    </div>
  );
}
