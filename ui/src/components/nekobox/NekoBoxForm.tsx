// SPDX-License-Identifier: GPL-3.0-only

// NekoBoxForm.tsx — поля диалога переноса из NekoBox (T-78): путь с кнопкой
// «Выбрать папку…», найденные установки, галочки «маршруты» и «настройки» и
// предупреждение «закройте NekoBox». Состояние держит NekoBoxImportDialog.
import type { JSX, MutableRefObject } from 'react';
import type { NekoBoxCandidate } from '../../gen/lavray_pb';
import { useI18n } from '../../hooks/useI18n';
import type { MessageKey } from '../../lib/i18n';
import { countsLine } from '../../lib/nekoBox';

interface Props {
  readonly path: string;
  readonly routes: boolean;
  readonly settings: boolean;
  readonly candidates: readonly NekoBoxCandidate[];
  readonly loading: boolean;
  readonly busy: boolean;
  readonly pathRef: MutableRefObject<HTMLInputElement | null>;
  readonly onPath: (path: string) => void;
  readonly onPick: () => void;
  readonly onRoutes: (on: boolean) => void;
  readonly onSettings: (on: boolean) => void;
}

const SOURCE_KEYS: Readonly<Record<string, MessageKey>> = {
  manual: 'nb.source.manual',
  process: 'nb.source.process',
  appdata: 'nb.source.appdata',
  localappdata: 'nb.source.localappdata',
};

function Candidates({ list, path, onPath }: Pick<Props, 'path' | 'onPath'> & { readonly list: readonly NekoBoxCandidate[] }): JSX.Element {
  const { t, lang } = useI18n();
  return (
    <div role="radiogroup" aria-label={t('nb.found')} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {list.map((c) => {
        const source = SOURCE_KEYS[c.source];
        return (
          <label key={c.path} className="cf-ack">
            <input
              type="radio"
              name="nbCandidate"
              checked={path.trim() === c.path}
              onChange={() => {
                onPath(c.path);
              }}
            />
            <span>
              <span className="mono">{c.path}</span>
              <span className="cap" style={{ display: 'block' }}>
                {source === undefined ? c.source : t(source)} · {countsLine(c.profiles, c.groups, c.routes, lang)}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function Check({ id, on, disabled, label, onChange }: { readonly id: string; readonly on: boolean; readonly disabled: boolean; readonly label: string; readonly onChange: (on: boolean) => void }): JSX.Element {
  return (
    <label className="cf-ack" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={on}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      <span>{label}</span>
    </label>
  );
}

export function NekoBoxForm(p: Props): JSX.Element {
  const { t } = useI18n();
  const selected = p.candidates.find((c) => c.path === p.path.trim());
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p className="cap">{t('nb.intro')}</p>
      {selected?.looksRunning === true && (
        <div className="banner banner-warn" role="alert">
          <div className="bn-t">{t('nb.closeWarn')}</div>
        </div>
      )}
      {p.candidates.length > 0 && <Candidates list={p.candidates} path={p.path} onPath={p.onPath} />}
      {p.candidates.length === 0 && !p.loading && <p className="cap">{t('nb.none')}</p>}
      <div className="field">
        <label htmlFor="nbPath">{t('nb.path')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            id="nbPath"
            ref={p.pathRef}
            style={{ flex: 1 }}
            aria-describedby="nbPathHint"
            spellCheck={false}
            value={p.path}
            disabled={p.busy}
            onChange={(e) => {
              p.onPath(e.target.value);
            }}
          />
          <button className="btn btn-sec" type="button" disabled={p.busy} onClick={p.onPick}>
            {t('nb.pick')}
          </button>
        </div>
        <p className="cap" id="nbPathHint">
          {t('nb.pathHint')}
        </p>
      </div>
      <Check id="nbRoutes" on={p.routes} disabled={p.busy} label={t('nb.routes')} onChange={p.onRoutes} />
      <Check id="nbSettings" on={p.settings} disabled={p.busy} label={t('nb.settings')} onChange={p.onSettings} />
    </div>
  );
}
