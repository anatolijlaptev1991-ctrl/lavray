// screen_settings.tsx — «Настройки» по прототипу v1.2 (DS §8): 10 секций с
// оглавлением, поиском по настройкам и скролл-наблюдением. Все контролы
// связаны с реальным API ядра (SettingsService), а тема/акцент/язык — с
// локальными предпочтениями (как в прототипе).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { create } from '@bufbuild/protobuf';
import { SettingType, SettingValueSchema } from '../gen/lavray_pb';
import type { SettingDescriptor, SettingValue } from '../gen/lavray_pb';
import { showCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { ConfirmDialog } from '../components/dialogs';
import { Icon, type IconName } from '../components/Icon';
import { withoutSecrets } from '../lib/backup';
import {
  applyTheme,
  loadPreferences,
  type AccentPreference,
  type ThemePreference,
} from '../lib/theme';
import { LANGUAGES, LANG_NATIVE, type Language } from '../lib/i18n';

interface Section {
  readonly id: string;
  readonly icon: IconName;
  readonly titleKey: string;
}

const SECTIONS: readonly Section[] = [
  { id: 'general', icon: 'settings', titleKey: 'sec.general' },
  { id: 'behavior', icon: 'sliders', titleKey: 'sec.behavior' },
  { id: 'network', icon: 'globe', titleKey: 'sec.network' },
  { id: 'tun', icon: 'route', titleKey: 'sec.tun' },
  { id: 'integration', icon: 'monitor', titleKey: 'sec.integration' },
  { id: 'hotkeys', icon: 'keyboard', titleKey: 'sec.hotkeys' },
  { id: 'appearance', icon: 'sun', titleKey: 'sec.appearance' },
  { id: 'backup', icon: 'save', titleKey: 'sec.backup' },
  { id: 'core', icon: 'cpu', titleKey: 'sec.core' },
  { id: 'about', icon: 'info', titleKey: 'sec.about' },
];

interface Row {
  readonly key: string;
  readonly type: SettingType;
  readonly labelKey: string;
  readonly descKey?: string;
}

const NETWORK_ROWS: readonly Row[] = [
  { key: 'inbound.address', type: SettingType.STRING, labelKey: 'set.addr' },
  { key: 'inbound.port', type: SettingType.INT, labelKey: 'set.port' },
  { key: 'inbound.auth.user', type: SettingType.STRING, labelKey: 'set.login' },
  { key: 'inbound.auth.pass', type: SettingType.STRING, labelKey: 'set.password' },
];

const TUN_ROWS: readonly Row[] = [
  { key: 'tun.impl', type: SettingType.INT, labelKey: 'tun.stack', descKey: 'tun.stack.d' },
  { key: 'tun.mtu', type: SettingType.INT, labelKey: 'tun.mtu' },
  { key: 'tun.strict_route', type: SettingType.BOOL, labelKey: 'tun.strict' },
  { key: 'tun.ipv6', type: SettingType.BOOL, labelKey: 'tun.ipv6' },
  { key: 'tun.fake_dns', type: SettingType.BOOL, labelKey: 'dns.fakeip', descKey: 'dns.fakeip.d' },
  { key: 'tun.bypass_process', type: SettingType.STRING, labelKey: 'tun.exclApps', descKey: 'tun.exclHint' },
  { key: 'tun.bypass_cidr', type: SettingType.STRING, labelKey: 'tun.exclAddr', descKey: 'tun.exclHint' },
];

/** Ключ «не проверять TLS-сертификаты по умолчанию» (FR-UI-177, skip_cert в NekoBox). */
const INSECURE_TLS_KEY = 'security.allow_insecure_default';

const CORE_ROWS: readonly Row[] = [
  { key: 'core.underlying_dns', type: SettingType.STRING, labelKey: 'dns.local', descKey: 'dns.local.d' },
  { key: 'mux.protocol', type: SettingType.STRING, labelKey: 'mux.protocol' },
  { key: 'mux.concurrency', type: SettingType.INT, labelKey: 'mux.concurrency' },
  { key: 'mux.default_on', type: SettingType.BOOL, labelKey: 'mux.default_on' },
  // T-11: ключ отключает проверку TLS-сертификатов у ВСЕХ серверов
  // (cfgbuild/outbounds.go: `s.AllowInsecure || st.AllowInsecureDefault`).
  // Раньше он носил чужую подпись «Совместимость» (dns.warn.t) без описания.
  // Подпись называет действие прямо; включение идёт через подтверждение.
  { key: INSECURE_TLS_KEY, type: SettingType.BOOL, labelKey: 'set.insecure', descKey: 'set.insecure.d' },
  { key: 'enable_external_cores', type: SettingType.BOOL, labelKey: 'core.external' },
];

function valueOf(v: SettingValue | undefined): string | boolean | number {
  const c = v?.value;
  if (c === undefined) return '';
  switch (c.case) {
    case 'stringValue':
      return c.value;
    case 'boolValue':
      return c.value;
    case 'intValue':
      return Number(c.value);
    case 'doubleValue':
      return c.value;
    case 'stringListValue':
      return c.value.items.join('\n');
    case 'jsonValue':
      return c.value;
    default:
      return '';
  }
}

/** Целое число из ввода; пустое поле и нечисло → null (раньше становились 0). */
function parseInteger(raw: string | boolean | number): number | null {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : null;
  const text = String(raw).trim();
  return /^-?\d+$/.test(text) ? Number(text) : null;
}

function toSettingValue(kind: SettingType, raw: string | boolean | number): SettingValue {
  switch (kind) {
    case SettingType.BOOL:
      return create(SettingValueSchema, {
        value: { case: 'boolValue', value: raw === true || raw === 'true' },
      });
    case SettingType.INT: {
      const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
      return create(SettingValueSchema, {
        value: { case: 'intValue', value: BigInt(Number.isFinite(n) ? n : 0) },
      });
    }
    case SettingType.STRING_LIST:
      return create(SettingValueSchema, {
        value: {
          case: 'stringListValue',
          value: { items: String(raw).split('\n').filter((s) => s.trim() !== '') },
        },
      });
    case SettingType.JSON:
      return create(SettingValueSchema, { value: { case: 'jsonValue', value: String(raw) } });
    default:
      return create(SettingValueSchema, { value: { case: 'stringValue', value: String(raw) } });
  }
}

export function SettingsScreen(): JSX.Element {
  const { t, lang, setLanguage } = useI18n();
  const core = useCore();
  const [theme, setTheme] = useState<ThemePreference>(() => loadPreferences(window.localStorage).theme);
  const [accent, setAccent] = useState<AccentPreference>(() => loadPreferences(window.localStorage).accent);
  const [descriptors, setDescriptors] = useState<SettingDescriptor[]>([]);
  const [values, setValues] = useState<Record<string, string | boolean | number>>({});
  const [query, setQuery] = useState('');
  const [activeSec, setActiveSec] = useState('general');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [coreVersion, setCoreVersion] = useState('');
  const [confirmInsecure, setConfirmInsecure] = useState(false);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Последние значения, принятые ядром: поле откатывается к ним при невалидном вводе.
  const accepted = useRef<Record<string, string | boolean | number>>({});

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const [desc, st, settings] = await Promise.all([
          core.settings.describeSettings({}),
          core.core.getStatus({}),
          core.settings.getSettings({}),
        ]);
        setDescriptors(desc.descriptors);
        setCoreVersion(st.coreVersion);
        const map: Record<string, string | boolean | number> = {};
        for (const [k, v] of Object.entries(settings.values)) map[k] = valueOf(v);
        accepted.current = map;
        setValues(map);
      } catch (e) {
        setErr(showCoreError(e, t));
      }
    })();
  }, [core, t]);

  const save = useCallback(
    async (key: string, kind: SettingType, raw: string | boolean | number): Promise<void> => {
      setErr('');
      const revert = (): void => {
        setValues((prev) => ({ ...prev, [key]: accepted.current[key] ?? '' }));
      };
      if (kind === SettingType.INT) {
        // Пустое или нечисловое поле в ядро не отправляется (раньше уходил 0).
        const n = parseInteger(raw);
        const isPort = key === 'inbound.port';
        if (n === null || (isPort && (n < 1 || n > 65535))) {
          setErr(`${key}: ${t(isPort ? 'set.portErr' : 'set.intErr')}`);
          revert();
          return;
        }
      }
      setValues((prev) => ({ ...prev, [key]: raw }));
      try {
        const res = await core.settings.setSettings({
          values: { [key]: toSettingValue(kind, raw) },
        });
        if (!res.acceptedKeys.includes(key)) {
          setErr(`${key}: ${t('set.portErr')}`);
          revert();
          return;
        }
        accepted.current = { ...accepted.current, [key]: raw };
        setOk(t('common.save'));
        window.setTimeout(() => {
          setOk('');
        }, 1500);
      } catch (e) {
        setErr(showCoreError(e, t));
        revert();
      }
    },
    [core, t],
  );

  // T-11: стабильные колбэки — иначе перерисовка раз в секунду (опрос
  // статуса) заново вешала бы обработчики диалога подтверждения.
  const closeInsecureConfirm = useCallback((): void => {
    setConfirmInsecure(false);
  }, []);
  const confirmInsecureOn = useCallback((): void => {
    setConfirmInsecure(false);
    void save(INSECURE_TLS_KEY, SettingType.BOOL, true);
  }, [save]);

  const setThemePref = useCallback((next: ThemePreference): void => {
    setTheme(next);
    applyTheme({ theme: next, accent, doc: document, win: window, storage: window.localStorage });
  }, [accent]);

  const setAccentPref = useCallback((next: AccentPreference): void => {
    setAccent(next);
    applyTheme({ theme, accent: next, doc: document, win: window, storage: window.localStorage });
  }, [theme]);

  // TOC: подсветка секции по скроллу (#main — скроллер приложения).
  useEffect(() => {
    const root = document.getElementById('main');
    // IntersectionObserver отсутствует в jsdom/старых webview — подсветка
    // TOC не критична, поэтому деградируем безопасно (иначе тесты падали).
    if (root === null || typeof IntersectionObserver === 'undefined') return undefined;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const id = (en.target as HTMLElement).dataset.sec;
          if (id !== undefined) setActiveSec(id);
        }
      },
      { root, rootMargin: '-12% 0px -72% 0px' },
    );
    for (const s of SECTIONS) {
      const el = cardRefs.current[s.id];
      if (el !== null && el !== undefined) obs.observe(el);
    }
    return (): void => {
      obs.disconnect();
    };
  }, [t]);

  const gotoSection = useCallback((id: string): void => {
    cardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const q = query.trim().toLowerCase();
  const matches = useCallback(
    (labelKey: string, descKey?: string): boolean => {
      if (q === '') return true;
      const label = t(labelKey).toLowerCase();
      if (label.includes(q)) return true;
      return descKey !== undefined && t(descKey).toLowerCase().includes(q);
    },
    [q, t],
  );
  const sectionVisible = useCallback(
    (id: string, titleKey: string): boolean => {
      if (q === '') return true;
      if (t(titleKey).toLowerCase().includes(q)) return true;
      const rows = id === 'network' ? NETWORK_ROWS : id === 'tun' ? TUN_ROWS : id === 'core' ? CORE_ROWS : [];
      return rows.some((r) => matches(r.labelKey, r.descKey));
    },
    [q, t, matches],
  );

  const visibleSections = useMemo(
    () => SECTIONS.filter((s) => sectionVisible(s.id, s.titleKey)),
    [sectionVisible],
  );

  const boolRow = (r: Row): JSX.Element => (
    <div className="set-row" key={r.key}>
      <div className="set-txt">
        <div className="set-l">{t(r.labelKey)}</div>
        {r.descKey !== undefined && <div className="set-d">{t(r.descKey)}</div>}
      </div>
      <div className="set-ctl">
        <button
          className={`sw${values[r.key] === true ? ' on' : ''}`}
          role="switch"
          aria-checked={values[r.key] === true}
          aria-label={t(r.labelKey)}
          onClick={() => {
            void save(r.key, r.type, values[r.key] !== true);
          }}
        />
      </div>
    </div>
  );

  // T-11: небезопасный режим TLS. Включение — только через подтверждение,
  // выключение (безопасное направление) — сразу. Пока включено, под строкой
  // висит предупреждение.
  const insecureOn = values[INSECURE_TLS_KEY] === true;
  const insecureRow = (r: Row): JSX.Element => (
    <Fragment key={r.key}>
      <div className="set-row">
        <div className="set-txt">
          <div className="set-l">{t(r.labelKey)}</div>
          {r.descKey !== undefined && <div className="set-d">{t(r.descKey)}</div>}
        </div>
        <div className="set-ctl">
          <button
            className={`sw${insecureOn ? ' on' : ''}`}
            role="switch"
            aria-checked={insecureOn}
            aria-label={t(r.labelKey)}
            onClick={() => {
              if (insecureOn) void save(r.key, r.type, false);
              else setConfirmInsecure(true);
            }}
          />
        </div>
      </div>
      {insecureOn && (
        <div className="banner banner-warn" role="status">
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="bn-t">{t('set.insecure.on')}</div>
        </div>
      )}
    </Fragment>
  );

  return (
    <div className="set">
      {err !== '' && (
        <div className="banner banner-err" role="alert">
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="bn-t">{err}</div>
        </div>
      )}
      {ok !== '' && <div className="toast-ok">{ok}</div>}

      <div className="searchwrap set-search">
        <span className="ic">
          <Icon name="search" />
        </span>
        <input
          className="input"
          type="text"
          placeholder={t('set.searchPh')}
          aria-label={t('set.searchPh')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          autoComplete="off"
        />
      </div>

      <div className="set-layout">
        <nav className="set-toc" aria-label={t('set.toc')}>
          {visibleSections.map((s) => (
            <button
              key={s.id}
              className={activeSec === s.id ? 'on' : ''}
              onClick={() => {
                gotoSection(s.id);
              }}
            >
              {t(s.titleKey as never)}
            </button>
          ))}
        </nav>
        <select
          className="select set-toc-jump"
          aria-label={t('set.tocJump')}
          value={activeSec}
          onChange={(e) => {
            gotoSection(e.target.value);
          }}
        >
          {visibleSections.map((s) => (
            <option key={s.id} value={s.id}>
              {t(s.titleKey as never)}
            </option>
          ))}
        </select>

        <div className="set-cols">
          {visibleSections.some((s) => s.id === 'general') && (
            <div
              className="card set-card"
              data-sec="general"
              ref={(el) => {
                cardRefs.current.general = el;
              }}
            >
              <h2>
                <span className="ic">
                  <Icon name="settings" />
                </span>
                <span>{t('sec.general')}</span>
              </h2>
              <div className="set-row">
                <div className="set-txt">
                  <div className="set-l">{t('set.lang')}</div>
                  <div className="set-d">{t('set.langD')}</div>
                </div>
                <div className="set-ctl">
                  <select
                    className="select"
                    value={lang}
                    onChange={(e) => {
                      setLanguage(e.target.value as Language);
                    }}
                    aria-label={t('set.lang')}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l} value={l}>
                        {LANG_NATIVE[l]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="set-row">
                <div className="set-txt">
                  <div className="set-l">{t('set.startMin')}</div>
                </div>
                <div className="set-ctl">
                  <button
                    className={`sw${values['ui.start_minimal'] === true ? ' on' : ''}`}
                    role="switch"
                    aria-checked={values['ui.start_minimal'] === true}
                    aria-label={t('set.startMin')}
                    onClick={() => {
                      void save('ui.start_minimal', SettingType.BOOL, values['ui.start_minimal'] !== true);
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {visibleSections.some((s) => s.id === 'behavior') && (
            <div
              className="card set-card"
              data-sec="behavior"
              ref={(el) => {
                cardRefs.current.behavior = el;
              }}
            >
              <h2>
                <span className="ic">
                  <Icon name="sliders" />
                </span>
                <span>{t('sec.behavior')}</span>
              </h2>
              <div className="set-row">
                <div className="set-txt">
                  <div className="set-l">{t('conn.traffic')}</div>
                  <div className="set-d">{t('set.rememberScreen')}</div>
                </div>
                <div className="set-ctl">
                  <button
                    className={`sw${values['ui.conn_stat'] === true ? ' on' : ''}`}
                    role="switch"
                    aria-checked={values['ui.conn_stat'] === true}
                    aria-label={t('conn.traffic')}
                    onClick={() => {
                      void save('ui.conn_stat', SettingType.BOOL, values['ui.conn_stat'] !== true);
                    }}
                  />
                </div>
              </div>
              <div className="set-row">
                <div className="set-txt">
                  <div className="set-l">{t('set.tray')}</div>
                </div>
                <div className="set-ctl">
                  <button
                    className={`sw${values['ui.start_minimal'] === true ? ' on' : ''}`}
                    role="switch"
                    aria-checked={values['ui.start_minimal'] === true}
                    aria-label={t('set.tray')}
                    onClick={() => {
                      // D7: скрытие консоли TUN — чужой ключ; для трея
                      // используем shell-owned ui.start_minimal.
                      void save('ui.start_minimal', SettingType.BOOL, values['ui.start_minimal'] !== true);
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {visibleSections.some((s) => s.id === 'network') && (
            <div
              className="card set-card"
              data-sec="network"
              ref={(el) => {
                cardRefs.current.network = el;
              }}
            >
              <h2>
                <span className="ic">
                  <Icon name="globe" />
                </span>
                <span>{t('sec.network')}</span>
              </h2>
              <div className="set-row">
                <div className="set-txt">
                  <div className="set-l">{t('set.local')}</div>
                </div>
              </div>
              {NETWORK_ROWS.filter((r) => matches(r.labelKey, r.descKey)).map((r) => (
                <div className="set-row" key={r.key}>
                  <div className="set-txt">
                    <label className="set-l" htmlFor={r.key}>
                      {t(r.labelKey as never)}
                    </label>
                  </div>
                  <div className="set-ctl">
                    {r.key === 'inbound.address' ? (
                      <select
                        className="select"
                        id={r.key}
                        value={values[r.key] === '0.0.0.0' ? 'all' : 'local'}
                        onChange={(e) => {
                          void save(r.key, r.type, e.target.value === 'all' ? '0.0.0.0' : '127.0.0.1');
                        }}
                      >
                        <option value="local">{t('set.addr.local')}</option>
                        <option value="all">{t('set.addr.all')}</option>
                      </select>
                    ) : (
                      <input
                        className="input input-mono set-num"
                        id={r.key}
                        type={r.type === SettingType.INT ? 'number' : r.key.endsWith('pass') ? 'password' : 'text'}
                        placeholder={
                          r.key === 'inbound.port'
                            ? '2080'
                            : r.key === 'inbound.auth.user'
                              ? t('set.login')
                              : r.key === 'inbound.auth.pass'
                                ? t('set.password')
                                : ''
                        }
                        value={String(values[r.key] ?? '')}
                        onChange={(e) => {
                          setValues((prev) => ({ ...prev, [r.key]: e.target.value }));
                        }}
                        onBlur={(e) => {
                          void save(r.key, r.type, e.target.value);
                        }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {visibleSections.some((s) => s.id === 'tun') && (
            <div
              className="card set-card"
              data-sec="tun"
              ref={(el) => {
                cardRefs.current.tun = el;
              }}
            >
              <h2>
                <span className="ic">
                  <Icon name="route" />
                </span>
                <span>{t('sec.tun')}</span>
              </h2>
              {TUN_ROWS.filter((r) => matches(r.labelKey, r.descKey)).map((r) =>
                r.type === SettingType.BOOL ? (
                  boolRow(r)
                ) : (
                  <div className="set-row" key={r.key}>
                    <div className="set-txt">
                      <label className="set-l" htmlFor={r.key}>
                        {t(r.labelKey as never)}
                      </label>
                      {r.descKey !== undefined && <div className="set-d">{t(r.descKey as never)}</div>}
                    </div>
                    <div className="set-ctl set-ctl-wide">
                      {r.key === 'tun.impl' ? (
                        <select
                          className="select"
                          id={r.key}
                          value={String(values[r.key] ?? 1)}
                          onChange={(e) => {
                            void save(r.key, r.type, e.target.value);
                          }}
                        >
                          <option value="1">gVisor</option>
                          <option value="2">{t('tun.stack.sys')}</option>
                          <option value="3">{t('tun.stack.mixed')}</option>
                        </select>
                      ) : r.key.startsWith('tun.bypass') ? (
                        <textarea
                          className="textarea mono"
                          id={r.key}
                          rows={3}
                          placeholder={r.key.endsWith('process') ? 'game.exe' : '192.168.0.0/16'}
                          value={String(values[r.key] ?? '')}
                          onChange={(e) => {
                            setValues((prev) => ({ ...prev, [r.key]: e.target.value }));
                          }}
                          onBlur={(e) => {
                            void save(r.key, r.type, e.target.value);
                          }}
                        />
                      ) : (
                        <input
                          className="input input-mono set-num"
                          id={r.key}
                          type="number"
                          value={String(values[r.key] ?? '')}
                          onChange={(e) => {
                            setValues((prev) => ({ ...prev, [r.key]: e.target.value }));
                          }}
                          onBlur={(e) => {
                            void save(r.key, r.type, e.target.value);
                          }}
                        />
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}

          {visibleSections.some((s) => s.id === 'integration') && (
            <div
              className="card set-card"
              data-sec="integration"
              ref={(el) => {
                cardRefs.current.integration = el;
              }}
            >
              <h2>
                <span className="ic">
                  <Icon name="monitor" />
                </span>
                <span>{t('sec.integration')}</span>
              </h2>
              {boolRow({
                key: 'tun.enabled',
                type: SettingType.BOOL,
                labelKey: 'mode.tun',
                descKey: 'tun.dlg.d',
              })}
              {boolRow({
                key: 'tun.kill_switch',
                type: SettingType.BOOL,
                labelKey: 'tun.strict',
                descKey: 'tun.strict.d',
              })}
            </div>
          )}

          {visibleSections.some((s) => s.id === 'hotkeys') && (
            <div
              className="card set-card"
              data-sec="hotkeys"
              ref={(el) => {
                cardRefs.current.hotkeys = el;
              }}
            >
              <h2>
                <span className="ic">
                  <Icon name="keyboard" />
                </span>
                <span>{t('sec.hotkeys')}</span>
              </h2>
              <p className="hint">{t('set.hotkeysD')}</p>
              {(
                [
                  ['hk.search', 'K'],
                  ['hk.toggle', 'D'],
                  ['hk.close', 'Esc'],
                  ['hk.settings', ','],
                ] as const
              ).map(([key, kbd]) => (
                <div className="hk-row" key={key}>
                  <div className="set-txt">
                    <div className="set-l">{t(key as never)}</div>
                  </div>
                  <kbd className="kbd">{kbd}</kbd>
                </div>
              ))}
            </div>
          )}

          {visibleSections.some((s) => s.id === 'appearance') && (
            <div
              className="card set-card"
              data-sec="appearance"
              ref={(el) => {
                cardRefs.current.appearance = el;
              }}
            >
              <h2>
                <span className="ic">
                  <Icon name="sun" />
                </span>
                <span>{t('sec.appearance')}</span>
              </h2>
              <div className="set-row">
                <div className="set-txt">
                  <div className="set-l">{t('set.theme')}</div>
                </div>
                <div className="set-ctl">
                  <div className="seg">
                    {(['dark', 'light', 'system'] as const).map((th) => (
                      <button
                        key={th}
                        className={theme === th ? 'on' : ''}
                        onClick={() => {
                          setThemePref(th);
                        }}
                      >
                        {t(`theme.${th}` as never)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="set-row">
                <div className="set-txt">
                  <div className="set-l">{t('set.accent')}</div>
                </div>
                <div className="set-ctl accdots">
                  {(['auto', 'amber', 'sage', 'graphite'] as const).map((ac) => (
                    <button
                      key={ac}
                      className={`accdot${accent === ac ? ' on' : ''}`}
                      title={t(`accent.${ac}` as never)}
                      aria-label={t(`accent.${ac}` as never)}
                      onClick={() => {
                        setAccentPref(ac);
                      }}
                    >
                      <i
                        style={{
                          background:
                            ac === 'amber'
                              ? '#E0A03A'
                              : ac === 'sage'
                                ? '#466F59'
                                : ac === 'graphite'
                                  ? '#8F8F96'
                                  : undefined,
                        }}
                      />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {visibleSections.some((s) => s.id === 'backup') && (
            <div
              className="card set-card"
              data-sec="backup"
              ref={(el) => {
                cardRefs.current.backup = el;
              }}
            >
              <h2>
                <span className="ic">
                  <Icon name="save" />
                </span>
                <span>{t('sec.backup')}</span>
              </h2>
              <div className="set-row">
                <div className="set-txt">
                  <div className="set-l">{t('bk.export')}</div>
                  <div className="set-d">{t('bk.hint')}</div>
                </div>
                <div className="set-ctl">
                  <button
                    className="btn btn-sec btn-sm"
                    aria-label={t('bk.export')}
                    onClick={() => {
                      void (async (): Promise<void> => {
                        try {
                          const res = await core.settings.getSettings({});
                          const all: Record<string, string | boolean | number> = {};
                          for (const [k, v] of Object.entries(res.values)) all[k] = valueOf(v);
                          // T-13: пароль локального прокси и другие секреты в файл не пишем.
                          const blob = new Blob([JSON.stringify(withoutSecrets(all), null, 2)], {
                            type: 'application/json',
                          });
                          const a = document.createElement('a');
                          a.href = URL.createObjectURL(blob);
                          a.download = `lavray-settings-${new Date().toISOString().slice(0, 10)}.json`;
                          a.click();
                          window.setTimeout(() => {
                            URL.revokeObjectURL(a.href);
                          }, 1000);
                        } catch (e) {
                          setErr(showCoreError(e, t));
                        }
                      })();
                    }}
                  >
                    {t('bk.exportBtn')}
                  </button>
                </div>
              </div>
              <div className="set-row">
                <div className="set-txt">
                  <div className="set-l">{t('bk.restore')}</div>
                  <div className="set-d">{t('bk.restoreD')}</div>
                </div>
                <div className="set-ctl">
                  <label className="btn btn-ghost btn-sm set-file">
                    {t('bk.restore')}
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f === undefined) return;
                        void (async (): Promise<void> => {
                          try {
                            const text = await f.text();
                            const parsed = JSON.parse(text) as Record<string, string | boolean | number>;
                            const byKey = new Map(descriptors.map((d) => [d.key, d]));
                            const payload: Record<string, SettingValue> = {};
                            for (const [k, v] of Object.entries(parsed)) {
                              const d = byKey.get(k);
                              if (d === undefined) continue;
                              payload[k] = toSettingValue(d.type, v);
                            }
                            await core.settings.setSettings({ values: payload });
                            setOk(t('bk.restore'));
                          } catch (e2) {
                            setErr(showCoreError(e2, t));
                          }
                        })();
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {visibleSections.some((s) => s.id === 'core') && (
            <div
              className="card set-card"
              data-sec="core"
              ref={(el) => {
                cardRefs.current.core = el;
              }}
            >
              <h2>
                <span className="ic">
                  <Icon name="cpu" />
                </span>
                <span>{t('sec.core')}</span>
              </h2>
              <div className="set-row">
                <div className="set-txt"><div className="set-l">{t('mux.title')}</div></div>
              </div>
              <div className="set-row">
                <div className="set-txt">
                  <div className="set-l">{t('set.appVersion')}</div>
                </div>
                <div className="set-ctl">
                  <span className="mono">v0.1.0</span>
                </div>
              </div>
              <div className="set-row">
                <div className="set-txt">
                  <div className="set-l">{t('set.coreVersion')}</div>
                </div>
                <div className="set-ctl">
                  <span className="mono">{coreVersion === '' ? '—' : coreVersion}</span>
                </div>
              </div>
              {CORE_ROWS.filter((r) => matches(r.labelKey, r.descKey)).map((r) =>
                r.key === INSECURE_TLS_KEY ? (
                  insecureRow(r)
                ) : r.type === SettingType.BOOL ? (
                  boolRow(r)
                ) : (
                  <div className="set-row" key={r.key}>
                    <div className="set-txt">
                      <label className="set-l" htmlFor={r.key}>
                        {t(r.labelKey as never)}
                      </label>
                      {r.descKey !== undefined && <div className="set-d">{t(r.descKey as never)}</div>}
                    </div>
                    <div className="set-ctl">
                      <input
                        className="input input-mono set-num"
                        id={r.key}
                        value={String(values[r.key] ?? '')}
                        onChange={(e) => {
                          setValues((prev) => ({ ...prev, [r.key]: e.target.value }));
                        }}
                        onBlur={(e) => {
                          void save(r.key, r.type, e.target.value);
                        }}
                      />
                    </div>
                  </div>
                ),
              )}
            </div>
          )}

          {visibleSections.some((s) => s.id === 'about') && (
            <div
              className="card set-card"
              data-sec="about"
              ref={(el) => {
                cardRefs.current.about = el;
              }}
            >
              <h2>
                <span className="ic">
                  <Icon name="info" />
                </span>
                <span>{t('sec.about')}</span>
              </h2>
              <div className="set-row" style={{ borderTop: 'none' }}>
                <div className="set-txt">
                  <div className="set-l">
                    LAVRay <span className="mono muted">v0.1.0</span>
                  </div>
                  <div className="set-d">{t('about.desc')}</div>
                </div>
              </div>
              <div className="about-links">
                <a
                  className="about-link"
                  href="https://github.com/anatolijlaptev1991-ctrl/lavray"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="ic">
                    <Icon name="github" />
                  </span>
                  <span>{t('about.repo')}</span>
                  <span className="ext-push">
                    <Icon name="external" />
                  </span>
                </a>
                <a
                  className="about-link"
                  href="https://github.com/anatolijlaptev1991-ctrl/lavray/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="ic">
                    <Icon name="alert" />
                  </span>
                  <span>{t('about.bug')}</span>
                  <span className="ext-push">
                    <Icon name="external" />
                  </span>
                </a>
                <a
                  className="about-link"
                  href="https://github.com/anatolijlaptev1991-ctrl/lavray/blob/main/LICENSE"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="ic">
                    <Icon name="file" />
                  </span>
                  <span>{t('about.license')}</span>
                  <span className="ext-push">
                    <Icon name="external" />
                  </span>
                </a>
                <button
                  className="about-link"
                  onClick={() => {
                    window.dispatchEvent(new Event('lavray:licenses'));
                  }}
                >
                  <span className="ic">
                    <Icon name="list" />
                  </span>
                  <span>{t('lic.title')}</span>
                  <span className="ext-push">
                    <Icon name="external" />
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {confirmInsecure && (
        <ConfirmDialog
          title={t('set.insecure.confirm.t')}
          text={t('set.insecure.confirm.d')}
          confirmLabel={t('set.insecure.confirm.ok')}
          danger
          onConfirm={confirmInsecureOn}
          onClose={closeInsecureConfirm}
        />
      )}
    </div>
  );
}
