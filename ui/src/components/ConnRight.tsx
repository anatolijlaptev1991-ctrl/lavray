// ConnRight.tsx — правая колонка экрана «Подключение» (прототип
// .conn-right): график трафика, карточка проверки утечек и карточка
// качества связи. Раньше колонки не было вовсе — главный экран выглядел
// полупустым, хотя стили (.leak-list/.hl-grid) уже были в CSS.
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Icon } from './Icon';
import { TrafficGraph } from './TrafficGraph';
import type { LeakReport } from '../gen/lavray_pb';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { showCoreError } from '../lib/core';
import { formatSince } from '../lib/i18n';
import { leakRows } from '../lib/leaks';

export interface ConnRightProps {
  readonly connected: boolean;
  /** Задержка активного профиля, мс (undefined — ещё не измерялась). */
  readonly latencyMs?: number | undefined;
  /** Имя активного пресета маршрутов и число правил. */
  readonly presetName: string;
  readonly presetRules: number;
}

export function ConnRight({
  connected,
  latencyMs,
  presetName,
  presetRules,
}: ConnRightProps): JSX.Element {
  const { t, tf, lang, plural } = useI18n();
  const core = useCore();
  const [report, setReport] = useState<LeakReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [err, setErr] = useState('');

  // Проверка утечек: один вызов CheckLeaks; строки собирает leakRows из того,
  // что ядро действительно измерило.
  const runLeakCheck = useCallback(async (): Promise<void> => {
    setBusy(true);
    setErr('');
    try {
      setReport(await core.diagnostics.checkLeaks({}));
      setCheckedAt(Date.now());
    } catch (e) {
      setErr(showCoreError(e, t));
    } finally {
      setBusy(false);
    }
  }, [core, t]);

  // При подключении проверка запускается сама — как в прототипе.
  useEffect(() => {
    if (connected) {
      void runLeakCheck();
    } else {
      setReport(null);
      setCheckedAt(null);
    }
  }, [connected, runLeakCheck]);
  const rows = report === null ? [] : leakRows(report, t);

  const relTime = (ms: number): string => formatSince(ms, lang);

  // latency_ms ядра: 0 — не измерялась, <0 — сервер недоступен; показываем
  // только реальный замер. Потери и время DNS ядро не измеряет: «—».
  const latency =
    connected && latencyMs !== undefined && latencyMs > 0
      ? `${String(latencyMs)} ${t('unit.ms')}`
      : '—';

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
                <span className={`lk-st lk-${r.kind}${r.kind === 'info' ? ' t3' : ''}`}>
                  <Icon
                    name={r.kind === 'ok' ? 'check' : r.kind === 'warn' ? 'alert' : 'info'}
                    size={16}
                  />
                  {r.kind !== 'info' && (
                    <span className="sr-only">{t(r.kind === 'ok' ? 'st.ok' : 'st.warn')}</span>
                  )}
                </span>
                <span className="lk-k">{t(r.label)}</span>
                <span className="lk-v">{r.value}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t2" style={{ fontSize: '.8125rem' }}>
            {t('leak.off')}
          </p>
        )}
        {err !== '' && <p className="toast-err" role="alert">{err}</p>}
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
            <span className="val" title={t('st.na')}>
              <span className="mono">—</span>
            </span>
          </div>
          <div className="hl-cell">
            <span className="cap">{t('health.dns')}</span>
            <span className="val" title={t('st.na')}>
              —
            </span>
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
                  {plural('pl.r', presetRules)}
                </span>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
