// screen_diag.tsx — «Проверки» по прототипу v1.2 (FR-UI-271/272/273):
// последовательный прогон самопроверок с анимацией статусов, итоговая
// сводка с числом проблем, карточка утечек (IP/DNS) и переход к тестеру
// маршрута.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { GetPublicIpRequest_Via, SelfCheckResult_Status } from '../gen/lavray_pb';
import { friendlyCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { Icon } from '../components/Icon';

type RunState = 'pending' | 'run' | 'ok' | 'warn' | 'err';

interface Row {
  readonly kind: number;
  readonly state: RunState;
  readonly detail: string;
  readonly fixCode: string;
}

const STATUS_TO_RUN: Record<number, RunState> = {
  [SelfCheckResult_Status.OK]: 'ok',
  [SelfCheckResult_Status.WARN]: 'warn',
  [SelfCheckResult_Status.FAIL]: 'err',
  [SelfCheckResult_Status.UNSPECIFIED]: 'pending',
};

const STATE_ICON: Record<RunState, Parameters<typeof Icon>[0]['name']> = {
  pending: 'gauge',
  run: 'refresh',
  ok: 'check',
  warn: 'alert',
  err: 'x',
};

const STATE_LABEL: Record<RunState, string> = {
  pending: 'chk.st.pending',
  run: 'chk.st.run',
  ok: 'st.ok',
  warn: 'st.warn',
  err: 'st.fail',
};

/** Локализация названия проверки по enum-значению. */
const KIND_LABEL: Record<number, string> = {
  1: 'chk.core.t',
  2: 'chk.server.t',
  3: 'chk.dns.t',
  4: 'chk.port.t',
  5: 'chk.proxy.t',
};

const FIX_LABEL: Record<string, string> = {
  restart_profile: 'err.retry',
  open_dns: 'chk.fix.dns',
  change_port: 'chk.fix.port',
  sync_clock: 'chk.fix.time',
  open_subscriptions: 'chk.fix.sub',
};

export function DiagScreen(): JSX.Element {
  const { t, tf } = useI18n();
  const core = useCore();
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState('');
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');
  const [publicIp, setPublicIp] = useState<string | null>(null);
  const [ipLeak, setIpLeak] = useState<string | null>(null);
  const token = useRef(0);

  const runChecks = useCallback(async (): Promise<void> => {
    const my = ++token.current;
    setErr('');
    setSummary('');
    setRunning(true);
    try {
      const res = await core.diagnostics.runSelfCheck({});
      const results = res.results;
      // Анимация: по одной проверке «запускается», затем показывает статус.
      setRows(
        results.map((r) => ({
          kind: r.kind,
          state: 'pending',
          detail: '',
          fixCode: '',
        })),
      );
      for (let i = 0; i < results.length; i++) {
        if (my !== token.current) return;
        const r = results[i];
        if (r === undefined) continue;
        setRows((prev) => prev.map((x, idx) => (idx === i ? { ...x, state: 'run' } : x)));
        await new Promise((resolve) => window.setTimeout(resolve, 220));
        if (my !== token.current) return;
        setRows((prev) =>
          prev.map((x, idx) =>
            idx === i
              ? {
                  ...x,
                  state: STATUS_TO_RUN[r.status] ?? 'pending',
                  detail: r.detail ?? '',
                  fixCode: r.fixCode,
                }
              : x,
          ),
        );
      }
      const bad = results.filter(
        (r) => r.status === SelfCheckResult_Status.FAIL || r.status === SelfCheckResult_Status.WARN,
      ).length;
      setSummary(bad === 0 ? t('chk.sum.ok') : tf('chk.sum.bad', { n: bad }));
    } catch (e) {
      setErr(friendlyCoreError(e));
    } finally {
      setRunning(false);
    }
  }, [core, t, tf]);

  // Утечки: публичный IP через туннель и напрямую — если совпадают,
  // значит трафик идёт мимо туннеля.
  const checkLeaks = useCallback(async (): Promise<void> => {
    setErr('');
    try {
      const [direct, tunnel] = await Promise.all([
        core.diagnostics.getPublicIp({ via: GetPublicIpRequest_Via.DIRECT }),
        core.diagnostics.getPublicIp({ via: GetPublicIpRequest_Via.THROUGH_TUNNEL }),
      ]);
      setPublicIp(direct.ip ?? null);
      setIpLeak(tunnel.ip ?? null);
    } catch (e) {
      setErr(friendlyCoreError(e));
    }
  }, [core]);

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  const leakSame = publicIp !== null && ipLeak !== null && publicIp === ipLeak;

  return (
    <div className="diag">
      {err !== '' && (
        <div className="banner banner-err" role="alert">
          <span className="ic"><Icon name="alert" /></span>
          <div className="bn-t">{err}</div>
        </div>
      )}

      <div className="card">
        <div className="card-h">
          <span className="ic"><Icon name="activity" /></span>
          <h2>{t('chk.title')}</h2>
          <span className="flex1" />
          <button className="btn btn-pri" disabled={running} onClick={() => void runChecks()}>
            <Icon name="refresh" />
            <span>{t('chk.run')}</span>
          </button>
        </div>
        <p className="cap" role="status" aria-live="polite">{summary}</p>
        <ol className="chk-list">
          {rows.map((r) => (
            <li className={`chk-item chk-${r.state}`} key={String(r.kind)}>
              <span className={`chk-st chk-${r.state}`}>
                <Icon name={STATE_ICON[r.state]} />
                <span className="sr-only">{t(STATE_LABEL[r.state] as never)}</span>
              </span>
              <span className="chk-body">
                <span className="chk-t">{t((KIND_LABEL[r.kind] ?? 'chk.core.t') as never)}</span>
                <span className="chk-d">{r.detail}</span>
              </span>
              {r.fixCode !== '' && FIX_LABEL[r.fixCode] !== undefined && (
                <button className="btn btn-sec btn-sm chk-fix">
                  {t(FIX_LABEL[r.fixCode] as never)}
                </button>
              )}
            </li>
          ))}
        </ol>
        {rows.length === 0 && !running && <p className="muted">{t('chk.run')}</p>}
      </div>

      {/* ---- Утечки ---- */}
      <div className="card">
        <div className="card-h">
          <span className="ic"><Icon name="shield" /></span>
          <h2>{t('leak.title')}</h2>
          <span className="flex1" />
          <button className="btn btn-sec btn-sm" onClick={() => void checkLeaks()}>
            <Icon name="shield" />
            <span>{t('leak.dns.run')}</span>
          </button>
        </div>
        <dl className="leak-grid">
          <div>
            <dt>{t('leak.direct')}</dt>
            <dd className="mono">{publicIp ?? t('leak.off')}</dd>
          </div>
          <div>
            <dt>{t('leak.dns')}</dt>
            <dd className="mono">{ipLeak ?? t('leak.off')}</dd>
          </div>
        </dl>
        {publicIp !== null && ipLeak !== null && (
          <div className={`banner ${leakSame ? 'banner-err' : 'banner-ok'}`} style={{ marginTop: 10 }}>
            <span className="ic"><Icon name={leakSame ? 'alert' : 'check'} /></span>
            <div className="bn-t">{leakSame ? t('leak.dns') : t('leak.dns.ok')}</div>
          </div>
        )}
      </div>

      <p style={{ marginTop: 12 }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            window.location.hash = 'screen=rules&tab=routing';
          }}
        >
          <Icon name="route" />
          <span>{t('chk.routeLink')}</span>
        </button>
      </p>
    </div>
  );
}
