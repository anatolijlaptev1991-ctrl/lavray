// SPDX-License-Identifier: GPL-3.0-only

// screen_dns.tsx — «DNS» по прототипу v1.2 (DS §8, FR-UI-148…156):
// режимы разрешения (авто/DoH/DoT/FakeIP/локальный/через туннель),
// advanced-редактор JSON с валидацией и форматированием, баннер
// «перезапустите ядро».
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { DnsSettings_Mode } from '../gen/lavray_pb';
import type { DnsSettings, DnsSettingsSchema } from '../gen/lavray_pb';
import { showCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import type { MessageKey } from '../lib/i18n';
import { Icon } from '../components/Icon';

// Карточки: серверы и маршрут запросов (туннель / напрямую) задаёт ядро по id
// (поле choice); экран только показывает выбранную карточку.
interface Preset {
  readonly id: string;
  readonly titleKey: MessageKey;
  readonly descKey: MessageKey;
}

const PRESETS: readonly Preset[] = [
  { id: 'auto', titleKey: 'dns.auto', descKey: 'dns.auto.d' },
  { id: 'tunnel', titleKey: 'dns.tunnel', descKey: 'dns.tunnel.d' },
  { id: 'doh', titleKey: 'dns.doh', descKey: 'dns.doh.d' },
  { id: 'dot', titleKey: 'dns.dot', descKey: 'dns.dot.d' },
  { id: 'local', titleKey: 'dns.local', descKey: 'dns.local.d' },
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
  const [restarting, setRestarting] = useState(false);

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
    async (next: MessageInitShape<typeof DnsSettingsSchema>): Promise<void> => {
      setErr('');
      setOk('');
      setBusy(true);
      try {
        const res = await core.dns.setDns({ dns: next });
        if (res.applied !== undefined) setDns(res.applied);
        setNeedsRestart(res.needsProfileRestart);
        setOk(t('toast.saved'));
      } catch (e) {
        setErr(showCoreError(e, t));
      } finally {
        setBusy(false);
      }
    },
    [core, t],
  );

  // T-28: «Перезапустить ядро» вызывает CoreService.RestartProfile. Баннер
  // скрывается только при успехе; отказ ядра (например, конфиг не собрался —
  // соединение при этом остаётся) показывается в баннере ошибки.
  const restart = useCallback(async (): Promise<void> => {
    setErr('');
    setOk('');
    setRestarting(true);
    try {
      await core.core.restartProfile({});
      setNeedsRestart(false);
    } catch (e) {
      setErr(showCoreError(e, t));
    } finally {
      setRestarting(false);
    }
  }, [core, t]);

  const pick = useCallback(
    async (p: Preset): Promise<void> => {
      setAdvanced(false);
      await save({ mode: DnsSettings_Mode.SIMPLE, choice: p.id });
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
      setOk(t('dns.jsonOk'));
    } catch (e) {
      setErr(showCoreError(e, t));
    }
  }, [core, json, t]);

  // Активная карточка — выбор, сохранённый ядром для активного пресета
  // (choice), а не вывод по префиксу адреса. «custom» карточек не подсвечивает.
  const activeId =
    dns === null ? '' : dns.mode === DnsSettings_Mode.ADVANCED ? 'advanced' : (dns.choice ?? 'auto');

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
      {ok !== '' && <div className="toast-ok" role="status">{ok}</div>}

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
                {t(p.titleKey)}
                {activeId === p.id && (
                  <span className="preset-check">
                    <Icon name="check" />
                  </span>
                )}
              </h3>
              <span className="desc">{t(p.descKey)}</span>
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
              disabled={restarting}
              aria-busy={restarting}
              onClick={() => void restart()}
            >
              <Icon name="refresh" />
              <span>{t('dns.restartBtn')}</span>
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={restarting}
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
            {advanced ? t('dns.custom') : 'JSON'}
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
            {dns?.fakeDnsEnabled === true && (
              <p className="hint" role="note">
                {t('dns.fakeipAdv')}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-sec btn-sm" onClick={() => void validate()}>
                {t('dns.validate')}
              </button>
              <button
                className="btn btn-pri btn-sm"
                disabled={busy || json.trim() === ''}
                onClick={() =>
                  void save({
                    mode: DnsSettings_Mode.ADVANCED,
                    advancedJson: json,
                    routingEnabled: dns?.routingEnabled ?? false,
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
              onClick={() =>
                void save({
                  mode: DnsSettings_Mode.SIMPLE,
                  choice: 'custom',
                  remoteDns: dns?.remoteDns ?? '',
                  directDns: dns?.directDns,
                  routingEnabled: dns?.routingEnabled ?? false,
                })
              }
            >
              {t('common.save')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
