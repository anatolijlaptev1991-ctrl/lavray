// SPDX-License-Identifier: GPL-3.0-only

// PresetDialogs.tsx — диалоги экрана «Правила»: название набора (сохранить как,
// создать пустой, переименовать) и подтверждения удаления и сброса.
import type { JSX } from 'react';
import { ConfirmDialog } from '../../components/dialogs';
import { useI18n } from '../../hooks/useI18n';
import type { PresetsApi } from '../../hooks/usePresets';
import type { RoutingPreset } from '../../gen/lavray_pb';
import { presetTitle } from '../../lib/presets';
import { PresetNameDialog } from './PresetNameDialog';

export type PresetDialog =
  | { readonly kind: 'name'; readonly mode: 'saveAs' | 'rename' | 'empty'; readonly preset?: RoutingPreset }
  | { readonly kind: 'delete' | 'reset'; readonly preset: RoutingPreset };

export interface PresetDialogsProps {
  readonly dialog: PresetDialog | null;
  readonly api: PresetsApi;
  readonly onClose: () => void;
}

export function PresetDialogs({ dialog, api, onClose }: PresetDialogsProps): JSX.Element | null {
  const { t, tf } = useI18n();
  if (dialog === null) return null;
  const nameOf = (p: RoutingPreset): string => presetTitle(p.id, p.displayName, t);

  if (dialog.kind === 'name') {
    const { mode, preset } = dialog;
    const initial =
      mode === 'rename' ? preset?.displayName ?? '' : mode === 'saveAs' && api.active !== undefined ? tf('rt.copyName', { name: nameOf(api.active) }) : t('rt.newPresetName');
    return (
      <PresetNameDialog
        titleKey={mode === 'rename' ? 'rt.rename' : mode === 'saveAs' ? 'rt.saveAs' : 'rt.newEmpty'}
        confirmKey={mode === 'empty' ? 'common.create' : 'common.save'}
        initial={initial}
        onClose={onClose}
        onSubmit={(name) => {
          onClose();
          if (mode === 'rename' && preset !== undefined) void api.update(preset.id, { displayName: name });
          else if (mode === 'saveAs' && api.active !== undefined) void api.copy(api.active.id, name, true);
          else if (mode === 'empty') void api.createEmpty(name);
        }}
      />
    );
  }

  const { preset } = dialog;
  const isDelete = dialog.kind === 'delete';
  return (
    <ConfirmDialog
      title={t(isDelete ? 'rt.deletePreset' : 'rt.resetSource')}
      text={tf(isDelete ? 'rt.deleteConfirm' : 'rt.resetConfirm', { name: nameOf(preset) })}
      confirmLabel={t(isDelete ? 'common.delete' : 'rt.resetSource')}
      danger={isDelete}
      onClose={onClose}
      onConfirm={() => {
        onClose();
        void (isDelete ? api.remove(preset.id) : api.reset(preset.id));
      }}
    />
  );
}
