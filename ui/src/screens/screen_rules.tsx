// screen_rules.tsx — «Правила» (DS §8): пресеты маршрутизации (5 builtin),
// активация, просмотр списков активного пресета. DNS-вкладка — сводка
// DnsService с редактированием простых полей.
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { RoutingPreset } from '../gen/lavray_pb';
import { friendlyCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';

export function RulesScreen(): JSX.Element {
  const { t } = useI18n();
  const core = useCore();
  const [presets, setPresets] = useState<RoutingPreset[]>([]);
  const [activeId, setActiveId] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const res = await core.routing.listPresets({});
        setPresets(res.presets);
        setActiveId(res.activePresetId);
      } catch (e) {
        setErr(friendlyCoreError(e));
      }
    })();
  }, [core]);

  const activate = useCallback(
    async (id: string): Promise<void> => {
      setErr('');
      setOk('');
      try {
        const res = await core.routing.activatePreset({ id });
        setActiveId(id);
        setOk(res.needsProfileRestart ? t('toast.coreRestarted') : t('toast.connected'));
      } catch (e) {
        setErr(friendlyCoreError(e));
      }
    },
    [core, t],
  );

  return (
    <div className="rules">
      {err !== '' && <div className="toast-err" role="alert">{err}</div>}
      {ok !== '' && <div className="toast-ok">{ok}</div>}
      <ul className="preset-grid">
        {presets.map((p) => (
          <li key={p.id}>
            <button
              className={`preset${p.id === activeId ? ' on' : ''}`}
              onClick={() => void activate(p.id)}
              aria-pressed={p.id === activeId}
            >
              <span className="preset-name">{p.displayName}</span>
              <span className="muted mono">
                rev {String(p.revision)}
                {p.builtin ? ' · builtin' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
