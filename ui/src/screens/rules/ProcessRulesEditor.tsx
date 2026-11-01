// SPDX-License-Identifier: GPL-3.0-only

// ProcessRulesEditor.tsx — правила для приложений (по имени процесса): список
// с выходом и платформой, добавление и удаление. Имена *.exe действуют только в
// Windows; в имени не допускается путь. У встроенного набора правила видны, но
// не меняются.
import { useState } from 'react';
import type { JSX } from 'react';
import { Outbound } from '../../gen/lavray_pb';
import type { ProcessRule, RoutingPreset } from '../../gen/lavray_pb';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../hooks/useI18n';
import { newProcessRule, OUTBOUND_OPTIONS, parseProcessNames } from '../../lib/presetDraft';

export interface ProcessRulesEditorProps {
  readonly preset: RoutingPreset | undefined;
  readonly onChange: (rules: ProcessRule[]) => void;
}

/** Подпись платформ правила: пусто — все системы, иначе перечисление (названия ОС не переводятся). */
function platformLabel(rule: ProcessRule, t: ReturnType<typeof useI18n>['t']): string {
  if (rule.platforms.length === 0) return t('rt.proc.allSystems');
  if (rule.platforms.length === 1 && rule.platforms[0] === 'windows') return t('rt.proc.winOnly');
  const names: Readonly<Record<string, string>> = { windows: 'Windows', linux: 'Linux', macos: 'macOS', openwrt: 'OpenWrt' };
  return rule.platforms.map((p) => names[p] ?? p).join(', ');
}

export function ProcessRulesEditor({ preset, onChange }: ProcessRulesEditorProps): JSX.Element {
  const { t, tf } = useI18n();
  const [names, setNames] = useState('');
  const [outbound, setOutbound] = useState(Outbound.DIRECT);
  const [error, setError] = useState('');
  const rules = preset?.processRules ?? [];
  const readOnly = preset === undefined || preset.builtin;

  const add = (): void => {
    const parsed = parseProcessNames(names);
    if (!parsed.ok) {
      if (parsed.reason === 'path') setError(tf('rt.proc.errPath', { name: parsed.bad ?? '' }));
      else setError(t(parsed.reason === 'many' ? 'rt.proc.errMany' : 'rt.proc.errEmpty'));
      return;
    }
    setError('');
    setNames('');
    onChange([...rules, newProcessRule(parsed.names, outbound)]);
  };

  return (
    <div className="card">
      <div className="card-h">
        <span className="ic"><Icon name="cpu" /></span>
        <h2>{t('rt.proc.t')}</h2>
      </div>
      {rules.length === 0 && <p className="cap">{t('rt.proc.empty')}</p>}
      <ul className="proc-rules" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rules.map((rule, i) => (
          <li key={`${String(i)}:${rule.processNames.join(',')}`} className="rule-chips" data-proc-rule>
            {rule.processNames.map((n) => (
              <span className="rule-chip" key={n}>{n}</span>
            ))}
            <span className="badge badge-info">
              {t(OUTBOUND_OPTIONS.find((o) => o.value === rule.outbound)?.labelKey ?? 'out.direct')}
            </span>
            <span className="badge">{platformLabel(rule, t)}</span>
            {!readOnly && (
              <button
                className="rule-chip-x"
                aria-label={`${t('common.delete')} ${rule.processNames.join(', ')}`}
                onClick={() => { onChange(rules.filter((_, j) => j !== i)); }}
              >
                <Icon name="x" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className={`field${error === '' ? '' : ' invalid'}`} style={{ marginTop: 10 }}>
          <div className="rt-in">
            <input
              className="input input-mono"
              aria-label={t('rt.proc.names')}
              placeholder={t('rt.proc.namesPh')}
              autoComplete="off"
              spellCheck={false}
              value={names}
              onChange={(e) => { setNames(e.target.value); setError(''); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add();
              }}
            />
            <select
              className="select"
              aria-label={t('rt.default')}
              value={String(outbound)}
              onChange={(e) => {
                const chosen = OUTBOUND_OPTIONS.find((o) => String(o.value) === e.target.value);
                if (chosen !== undefined) setOutbound(chosen.value);
              }}
            >
              {OUTBOUND_OPTIONS.map((o) => (
                <option key={o.labelKey} value={String(o.value)}>{t(o.labelKey)}</option>
              ))}
            </select>
            <button className="btn btn-sec btn-sm" onClick={add}>
              <Icon name="plus" />
              <span>{t('rt.proc.add')}</span>
            </button>
          </div>
          <span className="field-err" role="alert">{error}</span>
        </div>
      )}
    </div>
  );
}
