// SPDX-License-Identifier: GPL-3.0-only

// useProfileActions.tsx — действия меню строки профиля, которые раньше не были
// доступны из интерфейса: дублирование (CloneProfiles), сброс трафика
// (ResetTraffic), разрешение доменов (ResolveDomains), экспорт конфига
// (ExportConfig) и перенос в группу (MoveProfiles, диалог). Результат — сообщение
// или ошибка экрана; диалоги возвращаются готовым элементом.
import { useCallback, useState } from 'react';
import type { JSX } from 'react';
import { ExportConfigRequest_Purpose } from '../gen/lavray_pb';
import type { Profile } from '../gen/lavray_pb';
import { ConfirmDialog } from '../components/dialogs';
import { MoveToGroupDialog } from '../components/servers/MoveToGroupDialog';
import type { MoveGroup } from '../components/servers/MoveToGroupDialog';
import type { RowAction } from '../components/servers/RowMenu';
import { showCoreError } from '../lib/core';
import { saveFile } from '../lib/saveFile';
import { useCore } from './useCore';
import { useI18n } from './useI18n';

interface Options {
  readonly groups: readonly MoveGroup[];
  /** Список профилей изменился: перечитать. */
  readonly refresh: () => void;
  readonly onMessage: (text: string) => void;
  readonly onError: (text: string) => void;
}

export interface ProfileActions {
  /** Выполнить действие меню над профилем. */
  readonly run: (action: RowAction, profile: Profile) => void;
  /** Открытый диалог действия (перенос, предупреждение экспорта) или null. */
  readonly dialog: JSX.Element | null;
}

/** Имя файла экспорта: без символов, недопустимых в именах Windows. */
export function exportFileName(profile: Profile): string {
  const printable = Array.from(profile.name).map((ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch));
  const clean = printable.join('').replace(/[<>:"/\\|?*]+/g, ' ').trim().slice(0, 60);
  return clean === '' ? `profile-${String(profile.id)}` : clean;
}

export function useProfileActions({ groups, refresh, onMessage, onError }: Options): ProfileActions {
  const { t, tf } = useI18n();
  const core = useCore();
  const [moving, setMoving] = useState<Profile | null>(null);
  const [exporting, setExporting] = useState<Profile | null>(null);

  const guarded = useCallback(
    async (job: () => Promise<string>): Promise<void> => {
      onError('');
      try {
        onMessage(await job());
      } catch (e) {
        onError(showCoreError(e, t));
      }
    },
    [onError, onMessage, t],
  );

  const exportConfig = useCallback(
    (profile: Profile): Promise<void> =>
      guarded(async () => {
        const res = await core.profiles.exportConfig({
          profileId: profile.id,
          purpose: ExportConfigRequest_Purpose.RUN,
        });
        const saved = await saveFile(exportFileName(profile), 'json', res.singBoxJson);
        return saved === 'saved' ? t('exp.saved') : '';
      }),
    [core, guarded, t],
  );

  const run = useCallback(
    (action: RowAction, p: Profile): void => {
      const ids = [p.id];
      if (action === 'move') setMoving(p);
      else if (action === 'export') setExporting(p);
      else if (action === 'clone') {
        void guarded(async () => {
          const res = await core.profiles.cloneProfiles({ ids });
          refresh();
          return tf('srv.cloned', { n: res.newIds.length });
        });
      } else if (action === 'resetTraffic') {
        void guarded(async () => {
          await core.profiles.resetTraffic({ ids });
          refresh();
          return t('srv.trafficReset');
        });
      } else {
        void guarded(async () => {
          const res = await core.profiles.resolveDomains({ ids });
          refresh();
          return tf('srv.resolved', { n: res.resolvedIds.length, s: res.skippedIds.length, f: res.failed.length });
        });
      }
    },
    [core, guarded, refresh, t, tf],
  );

  const dialog = (
    <>
      {moving !== null && (
        <MoveToGroupDialog
          ids={[moving.id]}
          groups={groups}
          currentGroupId={moving.groupId}
          onClose={() => {
            setMoving(null);
          }}
          onMoved={() => {
            refresh();
            onMessage(t('mv.done'));
          }}
        />
      )}
      {exporting !== null && (
        <ConfirmDialog
          title={t('exp.title')}
          text={t('exp.warn')}
          confirmLabel={t('exp.do')}
          danger
          onConfirm={() => {
            const profile = exporting;
            setExporting(null);
            void exportConfig(profile);
          }}
          onClose={() => {
            setExporting(null);
          }}
        />
      )}
    </>
  );
  return { run, dialog: moving === null && exporting === null ? null : dialog };
}
