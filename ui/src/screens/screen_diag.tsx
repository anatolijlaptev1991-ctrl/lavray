// screen_diag.tsx — «Проверки» по прототипу v1.2 (FR-UI-271/272/273):
// последовательный прогон самопроверок с анимацией статусов, итоговая
// сводка с числом проблем, карточка утечек (IP/DNS) и переход к тестеру
// маршрута.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { GetPublicIpRequest_Via, RunSelfCheckRequest_CheckKind, SelfCheckResult_Status } from '../gen/lavray_pb';
import { showCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import type { MessageKey } from '../lib/i18n';
import { Icon } from '../components/Icon';

type RunState = 'pending' | 'run' | 'ok' | 'warn' | 'err' | 'skip';

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
  // UNSPECIFIED = проверка не выполнена (T-32): показываем «не проверено», не «ок».
  [SelfCheckResult_Status.UNSPECIFIED]: 'skip',
};

const STATE_ICON: Record<RunState, Parameters<typeof Icon>[0]['name']> = {
  pending: 'gauge',
  run: 'refresh',
  ok: 'check',
  warn: 'alert',
  err: 'x',
  skip: 'info',
};

const STATE_LABEL: Record<RunState, MessageKey> = {
  pending: 'chk.st.pending',
  run: 'chk.st.run',
  ok: 'st.ok',
  warn: 'st.warn',
  err: 'st.fail',
  skip: 'chk.st.skip',
};

/** Локализация названия проверки — по РЕАЛЬНОМУ enum контракта
 *  (SD-01 аудита round 3: прежняя таблица была сдвинута на единицу). */
const KIND_LABEL: Record<number, MessageKey> = {
  [RunSelfCheckRequest_CheckKind.CORE_ALIVE]: 'chk.core.t',
  [RunSelfCheckRequest_CheckKind.SERVER_REACHABLE]: 'chk.server.t',
  [RunSelfCheckRequest_CheckKind.DNS_RESOLVES]: 'chk.dns.t',
  [RunSelfCheckRequest_CheckKind.PROXY_ACTIVE]: 'chk.proxy.t',
  [RunSelfCheckRequest_CheckKind.CLOCK_SKEW]: 'chk.time.t',
  [RunSelfCheckRequest_CheckKind.SUBSCRIPTION_OK]: 'chk.sub.t',
  [RunSelfCheckRequest_CheckKind.PORT_FREE]: 'chk.port.t',
  [RunSelfCheckRequest_CheckKind.IPV6]: 'chk.ipv6.t',
};

/** Коды причин в detail (ядро: selfcheck.go) — переводятся через chk.d.<код>;
 *  остальной detail (задержка, сдвиг часов, текст ошибки) показывается как есть. */
const DETAIL_CODES = new Set([
  'no_connection',
  'blocked',
  'not_applicable',
  'no_subscription',
  'time_unreachable',
  'v6_direct',
]);

const FIX_LABEL: Record<string, MessageKey> = {
  // SD-05: коды по контракту (proto SelfCheckResult.fix_code).
  restart_profile: 'err.retry',
  open_dns: 'chk.fix.dns',
  change_port: 'chk.fix.port',
  fix_clock: 'chk.fix.time',
  sync_clock: 'chk.fix.time',
  open_subscriptions: 'chk.fix.sub',
  open_subscription: 'chk.fix.sub',
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
                  detail: DETAIL_CODES.has(r.detail ?? '') ? t(`chk.d.${r.detail ?? ''}` as MessageKey) : (r.detail ?? ''),
                  fixCode: r.fixCode,
                }
              : x,
          ),
        );
      }
      const bad = results.filter(
        (r) => r.status === SelfCheckResult_Status.FAIL || r.status === SelfCheckResult_Status.WARN,
      ).length;
      const skipped = results.filter((r) => r.status === SelfCheckResult_Status.UNSPECIFIED).length;
      // Сводка не обещает «Проблем не найдено», если часть проверок не выполнена.
      setSummary(
        bad > 0
          ? tf('chk.sum.bad', { n: bad })
          : skipped > 0
            ? tf('chk.sum.part', { n: skipped, total: results.length })
            : t('chk.sum.ok'),
      );
    } catch (e) {
      setErr(showCoreError(e, t));
    } finally {
      // SD-04: не сбрасываем флаг, если этот прогон уже устарел (запущен новый).
      if (my === token.current) setRunning(false);
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
      setErr(showCoreError(e, t));
    }
  }, [core, t]);

  useEffect(() => {
    void runChecks();
  }, [runChecks, t]);

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
        {(summary !== '' || rows.length > 0) && (
          <p className="cap" role="status" aria-live="polite">{summary}</p>
        )}
        <ol className="chk-list">
          {rows.map((r) => (
            <li className={`chk-item chk-${r.state === 'skip' ? 'pending' : r.state}`} key={String(r.kind)}>
              <span className={`chk-st chk-${r.state === 'skip' ? 'pending' : r.state}`}>
                <Icon name={STATE_ICON[r.state]} />
                <span className="sr-only">{t(STATE_LABEL[r.state])}</span>
              </span>
              <span className="chk-body">
                <span className="chk-t">{t(KIND_LABEL[r.kind] ?? 'chk.core.t')}</span>
                <span className="chk-d">{r.detail}</span>
              </span>
              {r.fixCode !== '' && FIX_LABEL[r.fixCode] !== undefined && (
                // SD-02: действие исправления открывает соответствующий
                // экран, а не висит кнопкой без обработчика.
                <button
                  className="btn btn-sec btn-sm chk-fix"
                  onClick={() => {
                    const target =
                      r.fixCode === 'open_dns'
                        ? 'screen=rules&tab=dns'
                        : r.fixCode === 'open_subscriptions' || r.fixCode === 'open_subscription'
                          ? 'screen=servers&tab=subscriptions'
                          : r.fixCode === 'change_port' || r.fixCode === 'restart_profile'
                            ? 'screen=settings'
                            : 'screen=connection';
                    window.location.hash = target;
                  }}
                >
                  {t(FIX_LABEL[r.fixCode] ?? 'err.retry')}
                </button>
              )}
            </li>
          ))}
        </ol>

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
            <dt>{t('conn.ip')}</dt>
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
