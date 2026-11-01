// SPDX-License-Identifier: GPL-3.0-only

// RulesScreen.tsx — «Маршрутизация» (DS §8, T-80): тестер маршрута, карточки
// наборов с меню (переименовать, дублировать, сбросить, экспорт, импорт,
// удалить), редактор списков и правил для приложений. Встроенный набор только
// для чтения: правка идёт через копию. Раскладка и связка; логика — usePresets.
import { useRef, useState } from 'react';
import type { JSX } from 'react';
import type { RoutingPreset } from '../../gen/lavray_pb';
import { Icon } from '../../components/Icon';
import type { MenuAnchor } from '../../components/ContextMenu';
import { RestartBanner } from '../../components/RestartBanner';
import { useI18n } from '../../hooks/useI18n';
import { usePresets } from '../../hooks/usePresets';
import { readFileText } from '../../lib/readFileText';
import { presetTitle } from '../../lib/presets';
import { NewPresetMenu } from './NewPresetMenu';
import { PresetCardMenu } from './PresetCardMenu';
import type { CardAction } from './PresetCardMenu';
import { PresetCards } from './PresetCards';
import { PresetDialogs } from './PresetDialogs';
import type { PresetDialog } from './PresetDialogs';
import { ProcessRulesEditor } from './ProcessRulesEditor';
import { RouteTester } from './RouteTester';
import { RuleListsEditor } from './RuleListsEditor';

interface OpenMenu {
  readonly preset: RoutingPreset;
  readonly anchor: MenuAnchor;
}

export function RulesScreen(): JSX.Element {
  const { t, tf } = useI18n();
  const api = usePresets();
  const { active, note } = api;
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [dialog, setDialog] = useState<PresetDialog | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const copyName = (p: RoutingPreset): string => tf('rt.copyName', { name: presetTitle(p.id, p.displayName, t) });
  const pickFile = (): void => { fileRef.current?.click(); };

  const onAction = (action: CardAction, p: RoutingPreset): void => {
    if (action === 'duplicate') void api.copy(p.id, copyName(p), false);
    else if (action === 'export') void api.exportPreset(p.id);
    else if (action === 'import') pickFile();
    else if (action === 'rename') setDialog({ kind: 'name', mode: 'rename', preset: p });
    else setDialog({ kind: action, preset: p });
  };

  const onFile = (file: File | undefined): void => {
    if (file === undefined) return;
    void readFileText(file).then(
      (text) => api.importText(text),
      () => { api.showNote({ kind: 'err', text: t('rt.importFailed') }); },
    );
  };

  return (
    <div className="rules">
      {note?.kind === 'err' && (
        <div className="banner banner-err" role="alert">
          <span className="ic"><Icon name="alert" /></span>
          <div className="bn-t">{note.text}</div>
        </div>
      )}
      {note?.kind === 'ok' && <div className="toast-ok" role="status">{note.text}</div>}
      {api.needsRestart && <RestartBanner busy={api.restarting} onRestart={() => void api.restart()} onLater={api.dismissRestart} />}

      <RouteTester />

      <div className="card">
        <div className="card-h">
          <span className="ic"><Icon name="route" /></span>
          <h2>{t('rt.presets')}</h2>
          <span className="flex1" />
          <NewPresetMenu
            canSaveAs={active !== undefined}
            onSaveAs={() => { setDialog({ kind: 'name', mode: 'saveAs' }); }}
            onCreateEmpty={() => { setDialog({ kind: 'name', mode: 'empty' }); }}
            onImport={pickFile}
          />
        </div>
        <PresetCards
          presets={api.presets}
          activeId={api.activeId}
          onActivate={(id) => void api.activate(id)}
          onMenu={(preset, anchor) => { setMenu({ preset, anchor }); }}
        />
      </div>

      <RuleListsEditor
        preset={active}
        onList={(kind, next) => { if (active !== undefined) void api.update(active.id, { lists: { [kind]: next } }); }}
        onDefaultOutbound={(value) => { if (active !== undefined) void api.update(active.id, { defaultOutbound: value }); }}
        onCustomize={() => { if (active !== undefined) void api.copy(active.id, copyName(active), true); }}
        onExists={() => { api.showNote({ kind: 'ok', text: t('rt.ruleExists') }); }}
      />
      <ProcessRulesEditor
        preset={active}
        onChange={(processRules) => { if (active !== undefined) void api.update(active.id, { processRules }); }}
      />

      {menu !== null && (
        <PresetCardMenu anchor={menu.anchor} preset={menu.preset} onAction={onAction} onDismiss={() => { setMenu(null); }} />
      )}
      <PresetDialogs dialog={dialog} api={api} onClose={() => { setDialog(null); }} />
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label={t('rt.importPreset')}
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = ''; // тот же файл можно выбрать снова
        }}
      />
    </div>
  );
}
