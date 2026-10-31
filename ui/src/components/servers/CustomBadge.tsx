// SPDX-License-Identifier: GPL-3.0-only

// CustomBadge.tsx — бейдж «custom: не подтверждено» в строке профиля (T-08B). Показан,
// только если у профиля есть custom-содержимое, которое ядро ещё не подтвердило (оно не
// применяется к конфигу). Это настоящая кнопка: достаётся Tab-ом и срабатывает Enter/
// Space, а нажатие открывает тот же diff-диалог, что и редактор профиля. Кнопка стоит
// рядом с основной кнопкой строки, а не внутри неё: вложенные кнопки недопустимы.
import type { JSX, KeyboardEvent, SyntheticEvent } from 'react';
import { useCustomFieldsConfirm } from '../../hooks/useCustomFieldsConfirm';
import { useI18n } from '../../hooks/useI18n';
import type { Profile } from '../../gen/lavray_pb';
import { needsCustomConfirm } from '../../lib/customFields';
import { CustomFieldsDiffDialog } from '../CustomFieldsDiffDialog';
import { Icon } from '../Icon';

interface Props {
  readonly profile: Profile;
  /** Ядро подтвердило содержимое: вызывающий перечитывает список профилей. */
  readonly onConfirmed: () => void;
}

/*
 * Диалог рисуется порталом в <body>, но события React идут вверх по дереву компонентов,
 * то есть в <li> строки: правый клик и Shift+F10 внутри диалога открывали бы меню строки.
 * Останавливаем только их: Esc и Tab ловит useModal на document, их трогать нельзя.
 */
function stopRowMenu(e: SyntheticEvent): void {
  e.stopPropagation();
}
function stopRowMenuKey(e: KeyboardEvent): void {
  if (e.key === 'F10' || e.key === 'ContextMenu') e.stopPropagation();
}

export function CustomBadge({ profile, onConfirmed }: Props): JSX.Element {
  const { t } = useI18n();
  const { dialogProps, open } = useCustomFieldsConfirm({ onConfirmed });
  return (
    <>
      {needsCustomConfirm(profile) && (
        <button
          type="button"
          className="badge badge-warn cf-badge"
          aria-label={`${t('cf.badge')} (${profile.name})`}
          aria-haspopup="dialog"
          title={t('cf.badgeTip')}
          onClick={() => {
            open(profile.id, profile.name);
          }}
        >
          <Icon name="alert" size={16} />
          {t('cf.badge')}
        </button>
      )}
      {/* Диалог живёт, пока открыт, даже если список успел перечитаться и бейдж ушёл. */}
      {dialogProps !== null && (
        <div style={{ display: 'contents' }} onContextMenu={stopRowMenu} onKeyDown={stopRowMenuKey}>
          <CustomFieldsDiffDialog {...dialogProps} />
        </div>
      )}
    </>
  );
}
