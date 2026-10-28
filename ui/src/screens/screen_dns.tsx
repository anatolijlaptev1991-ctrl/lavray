// screen_dns.tsx — «DNS» по прототипу v1.2 (DS §8, FR-UI-148…156):
// режимы разрешения (авто/DoH/DoT/FakeIP/локальный/через туннель),
// advanced-редактор JSON с валидацией и форматированием, баннер
// «перезапустите ядро».
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { DnsSettings_Mode } from '../gen/lavray_pb';
import type { DnsSettings } from '../gen/lavray_pb';
import { showCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { Icon } from '../components/Icon';

interface Preset {
  readonly id: string;
  readonly titleKey: string;
  readonly descKey: string;
  readonly remote: string;
  readonly direct: string;
  readonly advanced: boolean;
}

const PRESETS: readonly Preset[] = [
  { id: 'auto', titleKey: 'dns.auto', descKey: 'dns.auto.d', remote: 'https://dns.google/dns-query', direct: 'local', advanced: false },
  { id: 'tunnel', titleKey: 'dns.tunnel', descKey: 'dns.tunnel.d', remote: 'https://dns.google/dns-query', direct: 'local', advanced: false },
  { id: 'doh', titleKey: 'dns.doh', descKey: 'dns.doh.d', remote: 'https://dns.google/dns-query', direct: 'local', advanced: false },
  { id: 'dot', titleKey: 'dns.dot', descKey: 'dns.dot.d', remote: 'tls://1.1.1.1', direct: 'local', advanced: false },
  { id: 'local', titleKey: 'dns.local', descKey: 'dns.local.d', remote: 'local', direct: 'local', advanced: false },
];

export function DnsScreen(): JSX.Element {
  const { t } = useI18n();
  const core = useCore();
  const [dns, setDns] = useState<DnsSettings | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [json, setJson] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [needsRestart, setNeedsRestart] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await core.dns.getDns({});
      setDns(res);
      setAdvanced(res.mode === DnsSettings_Mode.ADVANCED);
      setJson(res.advancedJson ?? '');
    } catch (e) {
      setErr(showCoreError(e, t));
    }
  }, [core, t]);

  useEffect(() => {
    void load();
  }, [load, t]);

  const save = useCallback(
    async (next: Partial<DnsSettings>): Promise<void> => {
      if (dns === null) return;
      setErr('');
      setOk('');
      setBusy(true);
      try {
        const res = await core.dns.setDns({
          dns: {
            mode: next.mode ?? dns.mode,
            remoteDns: next.remoteDns ?? dns.remoteDns,
            directDns: next.directDns ?? dns.directDns,
            routingEnabled: next.routingEnabled ?? dns.routingEnabled,
            advancedJson: next.advancedJson ?? dns.advancedJson,
            remoteQueryStrategy: next.remoteQueryStrategy ?? dns.remoteQueryStrategy,
          },
        });
        if (res.applied !== undefined) setDns(res.applied);
        setNeedsRestart(res.needsProfileRestart);
        setOk(t('common.save'));
      } catch (e) {
        setErr(showCoreError(e, t));
      } finally {
        setBusy(false);
      }
    },
    [core, dns, t],
  );

  const pick = useCallback(
    async (p: Preset): Promise<void> => {
      setAdvanced(false);
      await save({
        mode: DnsSettings_Mode.SIMPLE,
        remoteDns: p.remote,
        directDns: p.direct,
      });
    },
    [save],
  );

  const validate = useCallback(async (): Promise<void> => {
    setErr('');
    setOk('');
    try {
      const res = await core.dns.validateDnsJson({ json });
      if (!res.valid) {
        setErr(res.errors.join('; '));
        return;
      }
      if (res.formatted !== undefined) setJson(res.formatted);
      setOk(t('dns.adv'));
    } catch (e) {
      setErr(showCoreError(e, t));
    }
  }, [core, json, t]);

  const activeId = ((): string => {
    if (dns === null) return '';
    if (dns.mode === DnsSettings_Mode.ADVANCED) return 'advanced';
    const remote = dns.remoteDns ?? '';
    if (remote === 'local') return 'local';
    if (remote.startsWith('tls://')) return 'dot';
    if (remote.startsWith('https://')) return 'doh';
    return 'auto';
  })();

  return (
    <div className="dns">
      {err !== '' && (
        <div className="banner banner-err" role="alert">
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="bn-t">{err}</div>
        </div>
      )}
      {ok !== '' && <div className="toast-ok">{ok}</div>}

      <div className="card">
        <div className="card-h">
          <span className="ic">
            <Icon name="globe" />
          </span>
          <h2>{t('dns.modes')}</h2>
        </div>
        <div className="dns-grid">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`dns-card${activeId === p.id ? ' on' : ''}`}
              aria-pressed={activeId === p.id}
              disabled={busy}
              onClick={() => void pick(p)}
            >
              <h3>
                {t(p.titleKey as never)}
                {activeId === p.id && (
                  <span className="preset-check">
                    <Icon name="check" />
                  </span>
                )}
              </h3>
              <span className="desc">{t(p.descKey as never)}</span>
            </button>
          ))}
        </div>

        {needsRestart && (
          <div className="restart-banner">
            <span className="ic">
              <Icon name="alert" />
            </span>
            <span className="t">{t('dns.restart')}</span>
            <button
              className="btn btn-sec btn-sm"
              onClick={() => {
                setNeedsRestart(false);
              }}
            >
              <Icon name="refresh" />
              <span>{t('dns.restartBtn')}</span>
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setNeedsRestart(false);
              }}
            >
              {t('dns.restartLater')}
            </button>
          </div>
        )}

        <div className="infoblock" style={{ marginTop: 14 }}>
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="t">
            <b>{t('dns.warn.t')}</b>
            <span>{t('dns.warn')}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <span className="ic">
            <Icon name="settings" />
          </span>
          <h2>{t('dns.adv')}</h2>
          <span className="flex1" />
          <button
            className="btn btn-sec btn-sm"
            onClick={() => {
              setAdvanced((v) => !v);
            }}
          >
            {advanced ? t('dns.auto') : t('dns.custom')}
          </button>
        </div>

        {advanced ? (
          <>
            <textarea
              className="input mono"
              rows={12}
              spellCheck={false}
              value={json}
              onChange={(e) => {
                setJson(e.target.value);
              }}
              aria-label="DNS JSON"
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-sec btn-sm" onClick={() => void validate()}>
                {t('dns.adv')}
              </button>
              <button
                className="btn btn-pri btn-sm"
                disabled={busy || json.trim() === ''}
                onClick={() =>
                  void save({
                    mode: DnsSettings_Mode.ADVANCED,
                    advancedJson: json,
                  })
                }
              >
                {t('common.save')}
              </button>
            </div>
          </>
        ) : (
          <div className="srv-import-row">
            <label className="cap">{t('dns.custom')}</label>
            <input
              className="input"
              value={dns?.remoteDns ?? ''}
              onChange={(e) => {
                if (dns !== null) setDns({ ...dns, remoteDns: e.target.value });
              }}
              aria-label={t('dns.custom')}
            />
            <button
              className="btn btn-pri btn-sm"
              disabled={busy}
              onClick={() => void save({ remoteDns: dns?.remoteDns ?? '' })}
            >
              {t('common.save')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
