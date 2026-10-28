// screen_updates.tsx — «Центр обновлений» по прототипу v1.2 (DS §8,
// FR-UI-230…240): канал stable/beta, проверка через TUF-цепочку,
// доступные компоненты (приложение/ядро/пресеты/гео), заметки, состояние
// цепочки доверия и ручная проверка из файла.
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { UpdateChannel, UpdateComponent } from '../gen/lavray_pb';
import type { CheckUpdatesResponse, ComponentUpdate, UpdateStateResponse } from '../gen/lavray_pb';
import { showCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { Icon } from '../components/Icon';

interface ChannelOption {
  readonly channel: UpdateChannel;
  readonly labelKey: 'upd.stable' | 'upd.beta';
}

const CHANNELS: readonly ChannelOption[] = [
  { channel: UpdateChannel.STABLE, labelKey: 'upd.stable' },
  { channel: UpdateChannel.BETA, labelKey: 'upd.beta' },
];

const COMPONENT_LABEL: Record<number, string> = {
  [UpdateComponent.APP]: 'upd.app',
  [UpdateComponent.CORE]: 'upd.core',
  [UpdateComponent.PRESETS]: 'rt.presets',
  [UpdateComponent.GEO]: 'set.geo',
  [UpdateComponent.WEBUI]: 'web.title',
};

function relWhen(ms: number, lang: string): string {
  if (ms <= 0) return '—';
  return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(
    Math.round((ms - Date.now()) / 864e5),
    'day',
  );
}

export function UpdatesScreen(): JSX.Element {
  const { t, tf, lang } = useI18n();
  const core = useCore();
  const [channel, setChannel] = useState<UpdateChannel>(UpdateChannel.STABLE);
  const [state, setState] = useState<UpdateStateResponse | null>(null);
  const [checked, setChecked] = useState<CheckUpdatesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const loadState = useCallback(async (): Promise<void> => {
    try {
      const res = await core.updates.getUpdateState({});
      setState(res);
    } catch {
      /* подсистема может быть не сконфигурирована */
    }
  }, [core]);

  useEffect(() => {
    void loadState();
  }, [loadState, t]);

  const check = useCallback(async (): Promise<void> => {
    setErr('');
    setOk('');
    setBusy(true);
    try {
      const res = await core.updates.checkUpdates({ channel });
      setChecked(res);
      if (res.available.length === 0) setOk(t('upd.upToDate'));
      await loadState();
    } catch (e) {
      setErr(showCoreError(e, t));
    } finally {
      setBusy(false);
    }
  }, [core, channel, t, loadState]);

  const download = useCallback(
    async (comp: ComponentUpdate): Promise<void> => {
      setErr('');
      setOk('');
      setBusy(true);
      try {
        const stream = core.updates.downloadUpdates({ components: [comp.component] });
        for await (const ev of stream) {
          if (ev.kind.case === 'progress') {
            const p = ev.kind.value;
            const pct =
              p.totalBytes > 0n ? Math.round((Number(p.downloadedBytes) / Number(p.totalBytes)) * 100) : 0;
            setOk(`${t('upd.stage.download')} ${String(pct)}%`);
          } else if (ev.kind.case === 'verified') {
            setOk(t('upd.stage.verifyOk'));
          }
        }
        await loadState();
      } catch (e) {
        setErr(showCoreError(e, t));
      } finally {
        setBusy(false);
      }
    },
    [core, t, loadState],
  );

  const lastCheck = state?.lastCheckedAtMs ?? checked?.lastCheckedAtMs ?? 0;

  return (
    <div className="updates">
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
            <Icon name="refresh" />
          </span>
          <h2>{t('updates.title')}</h2>
          <span className="flex1" />
          <span className="cap">{tf('upd.lastCheck', { when: relWhen(Number(lastCheck), lang) })}</span>
        </div>

        <div className="srv-import-row" style={{ flexWrap: 'wrap' }}>
          <label className="cap" htmlFor="updCh">
            {t('upd.channel')}
          </label>
          <select
            id="updCh"
            className="select"
            style={{ width: 'auto' }}
            value={String(channel)}
            onChange={(e) => {
              const chosen = CHANNELS.find((c) => String(c.channel) === e.target.value);
              if (chosen !== undefined) setChannel(chosen.channel);
            }}
          >
            {CHANNELS.map((c) => (
              <option key={c.labelKey} value={String(c.channel)}>
                {t(c.labelKey)}
              </option>
            ))}
          </select>
          <button className="btn btn-pri btn-sm" disabled={busy} onClick={() => void check()}>
            {busy ? t('upd.checking') : t('upd.checkNow')}
          </button>
        </div>

        {CHANNELS.find((c) => c.channel === channel)?.labelKey === 'upd.beta' && (
          <div className="infoblock" style={{ marginTop: 12 }}>
            <span className="ic">
              <Icon name="alert" />
            </span>
            <div className="t">
              <b>{t('upd.beta')}</b>
              <span>{t('upd.betaD')}</span>
            </div>
          </div>
        )}
      </div>

      {checked !== null && checked.available.length > 0 && (
        <div className="card">
          <div className="card-h">
            <span className="ic">
              <Icon name="zap" />
            </span>
            <h2>{t('upd.available')}</h2>
          </div>
          <ul className="upd-list">
            {checked.available.map((c) => (
              <li key={String(c.component)} className="upd-row">
                <div className="sub-main">
                  <span className="sub-name">
                    {t((COMPONENT_LABEL[c.component] ?? 'upd.app') as never)}
                    {c.mandatory && (
                      <span className="badge badge-warn" style={{ marginInlineStart: 8 }}>
                        {t('upd.beta')}
                      </span>
                    )}
                  </span>
                  <span className="muted mono">
                    {c.currentVersion} → {c.availableVersion ?? '—'}
                  </span>
                </div>
                <button className="btn btn-sec btn-sm" disabled={busy} onClick={() => void download(c)}>
                  {t('upd.now')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {checked !== null && checked.available.length === 0 && (
        <div className="card">
          <div className="card-h">
            <span className="ic">
              <Icon name="check" />
            </span>
            <h2>{t('upd.upToDate')}</h2>
          </div>
          <div className="sub-meta">
            <div className="row">
              <span className="k">{t('upd.app')}</span>
              <span className="mono">{checked.currentAppVersion}</span>
            </div>
            <div className="row">
              <span className="k">{t('upd.core')}</span>
              <span className="mono">{checked.coreVersion}</span>
            </div>
          </div>
        </div>
      )}

      {state?.chainState !== undefined && (
        <div className="card">
          <div className="card-h">
            <span className="ic">
              <Icon name="shield" />
            </span>
            <h2>{t('upd.stage.verify')}</h2>
          </div>
          <div className="sub-meta">
            <div className="row">
              <span className="k">root</span>
              <span className="mono">v{String(state.chainState.rootVersion)}</span>
            </div>
            {Object.entries(state.chainState.maxSerial).map(([ch, serial]) => (
              <div className="row" key={ch}>
                <span className="k">{ch}</span>
                <span className="mono">serial {String(serial)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
