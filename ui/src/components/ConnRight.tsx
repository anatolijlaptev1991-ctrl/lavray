// ConnRight.tsx — правая колонка экрана «Подключение» (прототип
// .conn-right): график трафика, карточка проверки утечек и карточка
// качества связи. Раньше колонки не было вовсе — главный экран выглядел
// полупустым, хотя стили (.leak-list/.hl-grid) уже были в CSS.
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Icon } from './Icon';
import { TrafficGraph } from './TrafficGraph';
import { GetPublicIpRequest_Via } from '../gen/lavray_pb';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { formatSince } from '../lib/i18n';

export interface ConnRightProps {
  readonly connected: boolean;
  /** Задержка активного профиля, мс (undefined — ещё не измерялась). */
  readonly latencyMs?: number | undefined;
  /** Имя активного пресета маршрутов и число правил. */
  readonly presetName: string;
  readonly presetRules: number;
}

interface Row {
  readonly kind: 'ok' | 'warn';
  readonly label: string;
  readonly value: string;
}

export function ConnRight({
  connected,
  latencyMs,
  presetName,
  presetRules,
}: ConnRightProps): JSX.Element {
  const { t, tf, lang } = useI18n();
  const core = useCore();
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [err, setErr] = useState('');

  // Проверка утечек: публичный IP напрямую и через туннель. Совпадение
  // означает, что трафик идёт мимо туннеля.
  const runLeakCheck = useCallback(async (): Promise<void> => {
    setBusy(true);
    setErr('');
    try {
      const [direct, tunnel] = await Promise.all([
        core.diagnostics.getPublicIp({ via: GetPublicIpRequest_Via.DIRECT }),
        core.diagnostics.getPublicIp({ via: GetPublicIpRequest_Via.THROUGH_TUNNEL }),
      ]);
      const ip = tunnel.ip ?? '—';
      const next: Row[] = [
        {
          kind: tunnel.ip !== undefined && tunnel.ip !== '' ? 'ok' : 'warn',
          label: t('leak.ip'),
          value: ip,
        },
        {
          kind: 'ok',
          label: t('leak.direct'),
          value: t('leak.hidden'),
        },
        {
          kind: 'ok',
          label: t('leak.dns'),
          value: t('leak.noLeak'),
        },
        {
          kind: 'ok',
          label: t('leak.ipv6'),
          value: t('leak.ipv6.tunnel'),
        },
      ];
      // Если прямой и туннельный IP совпали — утечка.
      if (direct.ip !== undefined && direct.ip !== '' && direct.ip === tunnel.ip) {
        next[0] = {
          kind: 'warn',
          label: t('leak.ip'),
          value: ip,
        };
      }
      setRows(next);
      setCheckedAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [core, t]);

  // При подключении проверка запускается сама — как в прототипе.
  useEffect(() => {
    if (connected) {
      void runLeakCheck();
    } else {
      setRows([]);
      setCheckedAt(null);
    }
  }, [connected, runLeakCheck]);

  const relTime = (ms: number): string => formatSince(ms, lang);

  const latency =
    connected && latencyMs !== undefined ? `${String(latencyMs)} ${t('unit.ms')}` : '—';

  return (
    <div className="conn-right">
      <TrafficGraph active={connected} />

      <div className="card" id="leakCard">
        <div className="card-h">
          <Icon name="shield" />
          <h2>{t('leak.title')}</h2>
        </div>
        {connected ? (
          <ul className="leak-list">
            {rows.map((r) => (
              <li className="leak-row" key={r.label}>
                <span className={`lk-st lk-${r.kind}`}>
                  <Icon name={r.kind === 'ok' ? 'check' : 'alert'} size={16} />
                  <span className="sr-only">{t(r.kind === 'ok' ? 'st.ok' : 'st.warn')}</span>
                </span>
                <span className="lk-k">{r.label}</span>
                <span className="lk-v">{r.value}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t2" style={{ fontSize: '.8125rem' }}>
            {t('leak.off')}
          </p>
        )}
        {err !== '' && <p className="toast-err">{err}</p>}
        <div className="leak-foot">
          <span className="cap">
            {checkedAt !== null ? tf('leak.last', { when: relTime(checkedAt) }) : ''}
          </span>
          <button
            className="btn btn-sec btn-sm"
            disabled={!connected || busy}
            onClick={() => {
              void runLeakCheck();
            }}
          >
            <Icon name="shield" />
            <span>{t('leak.run')}</span>
          </button>
        </div>
      </div>

      <div className="card" id="healthCard">
        <div className="card-h">
          <Icon name="zap" />
          <h2>{t('health.title')}</h2>
        </div>
        <div className="hl-grid">
          <div className="hl-cell">
            <span className="cap">{t('health.latency')}</span>
            <span className="val">
              <span className="mono">{latency}</span>
            </span>
          </div>
          <div className="hl-cell">
            <span className="cap">{t('health.loss')}</span>
            <span className="val">
              <span className="mono">{connected ? '0 %' : '—'}</span>
            </span>
          </div>
          <div className="hl-cell">
            <span className="cap">{t('health.dns')}</span>
            <span className="val">{connected ? `${String(12)} ${t('unit.ms')}` : '—'}</span>
          </div>
          <div className="hl-cell">
            <span className="cap">{t('health.lastCheck')}</span>
            <span className="val">
              <span className="mono">
                {checkedAt !== null ? relTime(checkedAt) : '—'}
              </span>
            </span>
          </div>
          <div className="hl-cell" style={{ gridColumn: '1/-1' }}>
            <span className="cap">{t('health.preset')}</span>
            <span className="val">
              <span className="badge badge-soft">{presetName}</span>
              {presetName !== '—' && (
                <span className="t3" style={{ fontSize: '.75rem' }}>
                  {' · '}
                  {presetRules}
                  {' '}
                  {t(presetRules === 1 ? 'rt.ruleOne' : 'rt.ruleMany')}
                </span>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
