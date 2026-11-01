// SPDX-License-Identifier: GPL-3.0-only

// RuleListsEditor.tsx — шесть списков правил набора (домены и IP для «блок /
// прокси / напрямую») и выход «для остального трафика». Встроенный набор —
// только чтение с кнопкой «Настроить копию»; свой — записи добавляются и
// удаляются сразу (каждое действие — одна правка набора).
import { useState } from 'react';
import type { JSX } from 'react';
import { Outbound } from '../../gen/lavray_pb';
import type { RoutingPreset } from '../../gen/lavray_pb';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../hooks/useI18n';
import type { MessageKey } from '../../lib/i18n';
import { addEntry, OUTBOUND_OPTIONS, removeEntry } from '../../lib/presetDraft';
import type { ListKind } from '../../lib/presetDraft';
import { presetRuleCount } from '../../lib/presets';

interface ListDef {
  readonly kind: ListKind;
  readonly labelKey: MessageKey;
  readonly ip: boolean;
}

const LISTS: readonly ListDef[] = [
  { kind: 'blockDomain', labelKey: 'out.block', ip: false },
  { kind: 'proxyDomain', labelKey: 'out.proxy', ip: false },
  { kind: 'directDomain', labelKey: 'out.direct', ip: false },
  { kind: 'blockIp', labelKey: 'out.block', ip: true },
  { kind: 'proxyIp', labelKey: 'out.proxy', ip: true },
  { kind: 'directIp', labelKey: 'out.direct', ip: true },
];

export interface RuleListsEditorProps {
  readonly preset: RoutingPreset | undefined;
  readonly onList: (kind: ListKind, next: string[]) => void;
  readonly onDefaultOutbound: (value: Outbound) => void;
  /** «Настроить копию» для встроенного набора. */
  readonly onCustomize: () => void;
  /** Запись уже есть в списке — сообщить, ничего не отправляя. */
  readonly onExists: () => void;
}

export function RuleListsEditor({ preset, onList, onDefaultOutbound, onCustomize, onExists }: RuleListsEditorProps): JSX.Element {
  const { t } = useI18n();
  const readOnly = preset === undefined || preset.builtin;
  const onAdd = (def: ListDef, raw: string): void => {
    if (preset === undefined) return;
    const res = addEntry(preset[def.kind], raw);
    if (res.kind === 'exists') onExists();
    else if (res.kind === 'added') onList(def.kind, res.list);
  };

  return (
    <div className="card">
      <div className="card-h">
        <span className="ic"><Icon name="sliders" /></span>
        <h2>{t('rt.rules')}</h2>
        <span className="flex1" />
        <span className="cap">{t('rt.rulesHint')}</span>
      </div>

      {preset?.builtin === true && (
        <div className="ro-banner">
          <span className="ic"><Icon name="lock" /></span>
          <span className="t">{t('rt.ro')}</span>
          <span className="flex1" />
          <button className="btn btn-sec btn-sm" onClick={onCustomize}>
            {t('rt.customizeCopy')}
          </button>
        </div>
      )}

      {/* Пустое состояние (прототип #ruleList): в наборе нет ни одного правила. */}
      {preset !== undefined && presetRuleCount(preset) === 0 && (
        <div className="empty" style={{ padding: '24px 12px' }}>
          <Icon name="route" />
          <div className="empty-t">{t('rt.rulesEmpty')}</div>
        </div>
      )}

      {LISTS.map((def) => {
        const items = preset?.[def.kind] ?? [];
        if (items.length === 0 && preset?.builtin === true) return null;
        return (
          <details className="fold" key={def.kind}>
            <summary>
              <span className="cap">{def.ip ? 'IP · ' : ''}{t(def.labelKey)}</span>
              <span className="muted">{items.length}</span>
            </summary>
            <div className="rule-chips">
              {items.map((entry) => (
                <span className="rule-chip" key={entry}>
                  {entry}
                  {!readOnly && (
                    <button
                      className="rule-chip-x"
                      aria-label={`${t('common.delete')} ${entry}`}
                      onClick={() => { onList(def.kind, removeEntry(items, entry)); }}
                    >
                      <Icon name="x" />
                    </button>
                  )}
                </span>
              ))}
              {!readOnly && (
                <AddRule kind={def.kind} placeholder={def.ip ? '10.0.0.0/8' : 'domain.example'} onAdd={(v) => { onAdd(def, v); }} />
              )}
            </div>
          </details>
        );
      })}

      <div className="rt-foot">
        <button
          className="btn btn-ghost btn-sm"
          disabled={readOnly}
          onClick={() => {
            // Правило нельзя добавить «пустым»: подвал фокусирует первое поле ввода.
            const input = document.querySelector<HTMLInputElement>('.rule-add input');
            if (input === null) return;
            const det = input.closest('details');
            if (det !== null) det.open = true;
            input.focus();
            input.scrollIntoView({ block: 'center' });
          }}
        >
          <Icon name="plus" />
          <span>{t('rt.addRule')}</span>
        </button>
        <span className="flex1" />
        <label className="cap" htmlFor="defOut">{t('rt.default')}</label>
        <select
          className="select"
          id="defOut"
          value={String(preset?.defaultOutbound ?? Outbound.PROXY)}
          disabled={readOnly}
          onChange={(e) => {
            const chosen = OUTBOUND_OPTIONS.find((o) => String(o.value) === e.target.value);
            if (chosen !== undefined) onDefaultOutbound(chosen.value);
          }}
        >
          {OUTBOUND_OPTIONS.map((o) => (
            <option key={o.labelKey} value={String(o.value)}>{t(o.labelKey)}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Инлайн-поле добавления записи. */
function AddRule({ kind, placeholder, onAdd }: { readonly kind: string; readonly placeholder: string; readonly onAdd: (v: string) => void }): JSX.Element {
  const [value, setValue] = useState('');
  const submit = (): void => {
    onAdd(value);
    setValue('');
  };
  return (
    <span className="rule-add" data-rule-add={kind}>
      <input
        className="input input-mono"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => { setValue(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim() !== '') submit();
        }}
      />
      <button className="btn btn-ghost btn-sm" disabled={value.trim() === ''} onClick={submit}>
        <Icon name="plus" />
      </button>
    </span>
  );
}
