// SPDX-License-Identifier: GPL-3.0-only

// UpdatesScreen.tsx — «Центр обновлений» (T-75, прототип v1.2 DS §8): канал
// stable/beta, ручная проверка, карточка состояния (найдено → скачивание →
// установка), «последняя проверка N дней назад», автопроверка, установка из
// файла и откат. Экран только собирает части; логика — в useUpdateFlow и
// lib/updates, а установку выполняет оболочка.
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../hooks/useI18n';
import { useUpdateFlow } from '../../hooks/useUpdateFlow';
import { useUpdateSettings } from '../../hooks/useUpdateSettings';
import { useUpdateState } from '../../hooks/useUpdateState';
import { showCoreError } from '../../lib/core';
import { inShell } from '../../lib/updates/shell';
import type { Channel } from '../../lib/updates/types';
import { AutoCheckRow } from './AutoCheckRow';
import { ChainStateCard } from './ChainStateCard';
import { InstallFromFileRow } from './InstallFromFileRow';
import { RollbackRow } from './RollbackRow';
import { UpdateStatusCard } from './UpdateStatusCard';
import { UpdatesHeader } from './UpdatesHeader';

export function UpdatesScreen(): JSX.Element {
  const { t } = useI18n();
  const [saveError, setSaveError] = useState('');
  const settings = useUpdateSettings((e) => {
    setSaveError(showCoreError(e, t));
  });
  const flow = useUpdateFlow(settings.channel);
  const info = useUpdateState();
  const { markNotConfigured, channelChanged } = flow;

  // Корня доверия в сборке нет: честно говорим об этом сразу, без «Проверить → отказ».
  useEffect(() => {
    if (info.notConfigured) markNotConfigured();
  }, [info.notConfigured, markNotConfigured]);

  const changeChannel = (next: Channel): void => {
    setSaveError('');
    void settings.setChannel(next).then((ok) => {
      if (ok) channelChanged();
    });
  };
  const native = inShell();

  return (
    <div className="updates">
      {saveError !== '' && (
        <div className="banner banner-err" role="alert">
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="bn-t">{saveError}</div>
        </div>
      )}
      <UpdatesHeader
        flow={flow}
        channel={settings.channel}
        onChannel={changeChannel}
        lastCheckedAtMs={Math.max(flow.lastCheckedAtMs, info.lastCheckedAtMs)}
      />
      <UpdateStatusCard flow={flow} />
      <div className="card">
        <AutoCheckRow checked={settings.autoCheck} onChange={(next) => void settings.setAutoCheck(next)} />
        {native && <InstallFromFileRow />}
        {native && info.rollback !== null && <RollbackRow version={info.rollback.version} />}
      </div>
      <ChainStateCard chain={info.chain} />
    </div>
  );
}
