// screen_rules.tsx — «Маршрутизация» по прототипу v1.2 (DS §8):
// тестер маршрута (CheckRoute), сетка пресетов с активацией, редактор
// списков правил (proxy/direct/block: домены и IP) и default outbound.
// Встроенный пресет только для чтения — копия создаётся кастомным.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Outbound as OutboundEnum } from '../gen/lavray_pb';
import type { RoutingPreset } from '../gen/lavray_pb';
import { friendlyCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { Icon } from '../components/Icon';

type ListKind =
  | 'proxyDomain'
  | 'directDomain'
  | 'blockDomain'
  | 'proxyIp'
  | 'directIp'
  | 'blockIp';

interface ListDef {
  readonly kind: ListKind;
  readonly labelKey: string;
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

const OUTBOUND_OPTIONS: readonly { value: OutboundEnum; labelKey: string }[] = [
  { value: OutboundEnum.PROXY, labelKey: 'out.proxy' },
  { value: OutboundEnum.DIRECT, labelKey: 'out.direct' },
  { value: OutboundEnum.BLOCK, labelKey: 'out.block' },
];

export function RulesScreen(): JSX.Element {
  const { t } = useI18n();
  const core = useCore();
  const [presets, setPresets] = useState<RoutingPreset[]>([]);
  const [activeId, setActiveId] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  // тестер маршрута
  const [query, setQuery] = useState('');
  const [routeResult, setRouteResult] = useState<{ outbound: string; rule: string | null } | null>(null);
  const [testing, setTesting] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await core.routing.listPresets({});
      setPresets(res.presets);
      setActiveId(res.activePresetId);
    } catch (e) {
      setErr(friendlyCoreError(e));
    }
  }, [core]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const active = useMemo(
    () => presets.find((p) => p.id === activeId),
    [presets, activeId],
  );

  const activate = useCallback(
    async (id: string): Promise<void> => {
      setErr('');
      setOk('');
      try {
        const res = await core.routing.activatePreset({ id });
        setActiveId(id);
        setOk(res.needsProfileRestart ? t('dns.restart') : t('common.save'));
        await reload();
      } catch (e) {
        setErr(friendlyCoreError(e));
      }
    },
    [core, t, reload],
  );

  const checkRoute = useCallback(async (): Promise<void> => {
    const q = query.trim();
    if (q === '') return;
    setErr('');
    setTesting(true);
    setRouteResult(null);
    try {
      // Приложение (game.exe) → process_name; иначе адрес/домен.
      const isProcess = /\.exe$|\.app$/i.test(q);
      // SR-02: для процесса address не заполняем (контракт: адрес — домен/IP).
      const res = await core.diagnostics.checkRoute(
        isProcess ? { processName: q } : { address: q },
      );
      const outbound =
        res.outbound === OutboundEnum.PROXY
          ? t('out.proxy')
          : res.outbound === OutboundEnum.DIRECT
            ? t('out.direct')
            : res.outbound === OutboundEnum.BLOCK
              ? t('out.block')
              : '—';
      setRouteResult({ outbound, rule: res.matchedRule ?? null });
    } catch (e) {
      setErr(friendlyCoreError(e));
    } finally {
      setTesting(false);
    }
  }, [core, query, t]);

  const toggleRule = useCallback(
    async (def: ListDef, entry: string): Promise<void> => {
      if (active === undefined || active.builtin) return;
      setErr('');
      try {
        const current = ((active[def.kind] as string[] | undefined) ?? []);
        const next = current.includes(entry)
          ? current.filter((x) => x !== entry)
          : [...current, entry];
        const res = await core.routing.updatePreset({
          preset: { ...active, [def.kind]: next },
          expectedRevision: active.revision,
        });
        const updated = res.preset ?? active;
        setPresets((prev) => prev.map((p) => (p.id === active.id ? updated : p)));
        setOk(t('common.save'));
      } catch (e) {
        setErr(friendlyCoreError(e));
      }
    },
    [core, active, t],
  );

  const addRule = useCallback(
    async (def: ListDef, entry: string): Promise<void> => {
      if (active === undefined || active.builtin || entry.trim() === '') return;
      await toggleRule(def, entry.trim());
    },
    [active, toggleRule],
  );

  const setDefaultOutbound = useCallback(
    async (value: OutboundEnum): Promise<void> => {
      if (active === undefined || active.builtin) return;
      setErr('');
      try {
        const res = await core.routing.updatePreset({
          preset: { ...active, defaultOutbound: value },
          expectedRevision: active.revision,
        });
        const updated = res.preset ?? active;
        setPresets((prev) => prev.map((p) => (p.id === active.id ? updated : p)));
      } catch (e) {
        setErr(friendlyCoreError(e));
      }
    },
    [core, active],
  );

  return (
    <div className="rules">
      {err !== '' && (
        <div className="banner banner-err" role="alert">
          <span className="ic"><Icon name="alert" /></span>
          <div className="bn-t">{err}</div>
        </div>
      )}
      {ok !== '' && <div className="toast-ok">{ok}</div>}

      {/* ---- Тестер маршрута ---- */}
      <div className="card">
        <div className="card-h">
          <span className="ic"><Icon name="search" /></span>
          <h2>{t('rt.test.t')}</h2>
        </div>
        <div className="rt-in">
          <label className="sr-only" htmlFor="rtQ">{t('rt.test.label')}</label>
          <input
            className="input input-mono"
            id="rtQ"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('rt.test.ph')}
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void checkRoute();
            }}
          />
          <button className="btn btn-pri" onClick={() => void checkRoute()} disabled={testing}>
            {t('rt.test.run')}
          </button>
        </div>
        <p className="rt-res" role="status" aria-live="polite">
          {routeResult === null
            ? ''
            : `${routeResult.outbound}${routeResult.rule !== null ? ` · ${routeResult.rule}` : ''}`}
        </p>
      </div>

      {/* ---- Пресеты ---- */}
      <div className="card">
        <div className="card-h">
          <span className="ic"><Icon name="route" /></span>
          <h2>{t('rt.presets')}</h2>
        </div>
        <div className="preset-grid">
          {presets.length === 0 && (
            <div className="empty" style={{ gridColumn: '1 / -1' }}>
              <Icon name="route" />
              <div className="empty-t">{t('rt.presets')}</div>
              <div className="empty-d">{t('cx.empty.d')}</div>
            </div>
          )}
          {presets.map((p) => (
            <button
              key={p.id}
              className={`preset${p.id === activeId ? ' on' : ''}`}
              onClick={() => void activate(p.id)}
              aria-pressed={p.id === activeId}
            >
              <span className="preset-top">
                <h3>{p.displayName}</h3>
                {p.id === activeId && (
                  <span className="preset-check"><Icon name="check" /></span>
                )}
              </span>
              <span className="muted mono">
                rev {String(p.revision)}{p.builtin ? ' · builtin' : ''}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ---- Правила ---- */}
      <div className="card">
        <div className="card-h">
          <span className="ic"><Icon name="sliders" /></span>
          <h2>{t('rt.rules')}</h2>
          <span className="flex1" />
          <span className="cap">{t('rt.rulesHint')}</span>
        </div>

        {active?.builtin === true && (
          <div className="ro-banner">
            <span className="ic"><Icon name="lock" /></span>
            <span className="t">{t('rt.ro')}</span>
            <span className="flex1" />
            <button
              className="btn btn-sec btn-sm"
              onClick={() => {
                void (async (): Promise<void> => {
                  try {
                    const res = await core.routing.createPreset({
                      builtinSourceId: active.id,
                    });
                    await reload();
                    setActiveId(res.id);
                    setOk(t('rt.customizeCopy'));
                  } catch (e) {
                    setErr(friendlyCoreError(e));
                  }
                })();
              }}
            >
              {t('rt.customizeCopy')}
            </button>
          </div>
        )}

        {LISTS.map((def) => {
          const items = (active?.[def.kind] ?? []);
          if (items.length === 0 && active?.builtin === true) return null;
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
                    {active?.builtin !== true && (
                      <button
                        className="rule-chip-x"
                        aria-label={`${t('common.delete')} ${entry}`}
                        onClick={() => void toggleRule(def, entry)}
                      >
                        <Icon name="x" />
                      </button>
                    )}
                  </span>
                ))}
                {active?.builtin !== true && (
                  <AddRule
                    kind={def.kind}
                    placeholder={def.ip ? '10.0.0.0/8' : 'domain.example'}
                    onAdd={(v) => void addRule(def, v)}
                  />
                )}
              </div>
            </details>
          );
        })}

        <div className="rt-foot">
          <button
            className="btn btn-ghost btn-sm"
            disabled={active?.builtin === true}
            onClick={() => {
              const first = LISTS.find((l) => (active?.[l.kind])?.length !== undefined);
              if (first !== undefined) void addRule(first, '');
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
            value={String(active?.defaultOutbound ?? OutboundEnum.PROXY)}
            disabled={active?.builtin === true}
            onChange={(e) => {
              const chosen = OUTBOUND_OPTIONS.find((o) => String(o.value) === e.target.value);
              if (chosen !== undefined) void setDefaultOutbound(chosen.value);
            }}
          >
            {OUTBOUND_OPTIONS.map((o) => (
              <option key={o.labelKey} value={String(o.value)}>{t(o.labelKey as never)}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

/** Инлайн-поле добавления правила. */
function AddRule({
  kind,
  placeholder,
  onAdd,
}: {
  readonly kind: string;
  readonly placeholder: string;
  readonly onAdd: (v: string) => void;
}): JSX.Element {
  const [value, setValue] = useState('');
  return (
    <span className="rule-add" data-rule-add={kind}>
      <input
        className="input input-mono"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => { setValue(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim() !== '') {
            onAdd(value);
            setValue('');
          }
        }}
      />
      <button
        className="btn btn-ghost btn-sm"
        disabled={value.trim() === ''}
        onClick={() => {
          onAdd(value);
          setValue('');
        }}
      >
        <Icon name="plus" />
      </button>
    </span>
  );
}
