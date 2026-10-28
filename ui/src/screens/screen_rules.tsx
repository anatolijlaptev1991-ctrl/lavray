// screen_rules.tsx — «Маршрутизация» по прототипу v1.2 (DS §8):
// тестер маршрута (CheckRoute), сетка пресетов с активацией, редактор
// списков правил (proxy/direct/block: домены и IP) и default outbound.
// Встроенный пресет только для чтения — копия создаётся кастомным.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { create } from '@bufbuild/protobuf';
import { Outbound as OutboundEnum, RoutingPresetSchema } from '../gen/lavray_pb';
import type { RoutingPreset } from '../gen/lavray_pb';
import { showCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { Icon } from '../components/Icon';
import { DialogShell } from '../components/dialogs';

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

/** Примеры для тестера маршрута (прототип #rtSugg). */
const ROUTE_SUGGESTIONS = [
  'lori.ru',
  'chat.openai.com',
  'store.steampowered.com',
  'example.org',
  '192.168.1.10',
  'cursor.exe',
] as const;

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
  // Меню «Новый пресет» (#rtNew) и диалог создания пустого пресета.
  const [newPresetAt, setNewPresetAt] = useState<{ x: number; y: number } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await core.routing.listPresets({});
      setPresets(res.presets);
      setActiveId(res.activePresetId);
    } catch (e) {
      setErr(showCoreError(e, t));
    }
  }, [core, t]);

  useEffect(() => {
    void reload();
  }, [reload, t]);

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
        setErr(showCoreError(e, t));
      }
    },
    [core, t, reload],
  );

  /** Копия пресета (встроенного или своего) — «Сохранить как». */
  const copyPreset = useCallback(
    async (sourceId: string, name?: string): Promise<void> => {
      setErr('');
      try {
        const res = await core.routing.createPreset({
          builtinSourceId: sourceId,
          ...(name === undefined ? {} : { preset: create(RoutingPresetSchema, { displayName: name }) }),
        });
        await reload();
        setActiveId(res.id);
        setOk(t('rt.customizeCopy'));
      } catch (e) {
        setErr(showCoreError(e, t));
      }
    },
    [core, reload, t],
  );

  const checkRoute = useCallback(
    async (override?: string): Promise<void> => {
      const q = (override ?? query).trim();
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
        setErr(showCoreError(e, t));
      } finally {
        setTesting(false);
      }
    },
    [core, query, t],
  );

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
        setErr(showCoreError(e, t));
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
        setErr(showCoreError(e, t));
      }
    },
    [core, active, t],
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
        {/* Примеры запросов (прототип #rtSugg): клик подставляет значение и
            сразу проверяет маршрут — быстрее, чем набирать вручную. */}
        <div className="rt-sugg">
          {ROUTE_SUGGESTIONS.map((sg) => (
            <button
              key={sg}
              type="button"
              onClick={() => {
                setQuery(sg);
                void checkRoute(sg);
              }}
            >
              {sg}
            </button>
          ))}
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
          <span className="flex1" />
          {/* Меню «Новый пресет» (прототип #rtNew): сохранение копии
              встроенного или создание пустого. */}
          <button
            className="btn btn-sec btn-sm"
            aria-haspopup="menu"
            aria-expanded={newPresetAt !== null}
            onClick={(e) => {
              if (newPresetAt !== null) {
                setNewPresetAt(null);
                return;
              }
              const r = e.currentTarget.getBoundingClientRect();
              setNewPresetAt({ x: r.left - 120, y: r.bottom + 4 });
            }}
          >
            <Icon name="plus" />
            <span>{t('rt.new')}</span>
          </button>
        </div>
        {newPresetAt !== null && (
          <div
            className="menu"
            role="menu"
            style={{ left: newPresetAt.x, top: newPresetAt.y }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNewPresetAt(null);
            }}
          >
            <button
              className="menu-item"
              role="menuitem"
              disabled={active === undefined}
              onClick={() => {
                setNewPresetAt(null);
                if (active !== undefined) {
                  void copyPreset(active.id, `${active.displayName} (${t('rt.copyName')})`);
                }
              }}
            >
              <Icon name="copy" size={16} />
              <span>{t('rt.saveAs')}</span>
            </button>
            <button
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setNewPresetAt(null);
                setNewOpen(true);
              }}
            >
              <Icon name="plus" size={16} />
              <span>{t('rt.newEmpty')}</span>
            </button>
          </div>
        )}
        <div className="preset-grid">
          {presets.length === 0 && (
            <div className="empty" style={{ gridColumn: '1 / -1' }}>
              <Icon name="route" />
              <div className="empty-t">{t('rt.empty.t')}</div>
              <div className="empty-d">{t('rt.empty.d')}</div>
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
                void copyPreset(active.id);
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
              // Правило нельзя добавить «пустым»: подвал фокусирует первое
              // поле ввода. Раньше сюда передавалась пустая строка, и
              // addRule отбрасывал вызов — кнопка не делала ничего.
              const input = document.querySelector<HTMLInputElement>('.rule-add input');
              if (input !== null) {
                const det = input.closest('details');
                if (det !== null) det.open = true;
                input.focus();
                input.scrollIntoView({ block: 'center' });
              }
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

      {newOpen && (
        <DialogShell
          titleId="rtNewTitle"
          title={t('rt.newEmpty')}
          size="sm"
          onClose={() => {
            setNewOpen(false);
            setNewName('');
          }}
          footer={
            <>
              <span className="flex1" />
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setNewOpen(false);
                  setNewName('');
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-pri"
                onClick={() => {
                  void (async (): Promise<void> => {
                    setNewOpen(false);
                    try {
                      const res = await core.routing.createPreset({
                        preset: create(RoutingPresetSchema, {
                          displayName:
                            newName.trim() === '' ? t('rt.newPresetName') : newName.trim(),
                        }),
                      });
                      await reload();
                      setActiveId(res.id);
                      setNewName('');
                    } catch (e) {
                      setErr(showCoreError(e, t));
                    }
                  })();
                }}
              >
                {t('common.create')}
              </button>
            </>
          }
        >
          <p className="hint">{t('rt.presetName')}</p>
          <label className="sr-only" htmlFor="rtNewName">{t('rt.presetName')}</label>
          <input
            className="input"
            id="rtNewName"
            autoComplete="off"
            placeholder={t('rt.newPresetName')}
            value={newName}
            onChange={(e) => { setNewName(e.target.value); }}
          />
        </DialogShell>
      )}
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
