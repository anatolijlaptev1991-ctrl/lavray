// screen_diag.tsx — «Диагностика» (DS §8): самопроверки ядра, проверка
// маршрута адреса, публичный IP, журнал (хвост).
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { LogLine, SelfCheckResult } from '../gen/lavray_pb';
import { SelfCheckResult_Status } from '../gen/lavray_pb';
import { friendlyCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';

export function DiagScreen(): JSX.Element {
  const { t } = useI18n();
  const core = useCore();
  const [checks, setChecks] = useState<SelfCheckResult[]>([]);
  const [addr, setAddr] = useState('example.org');
  const [routeOut, setRouteOut] = useState('');
  const [ip, setIp] = useState('');
  const [log, setLog] = useState<LogLine[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const tail = await core.logs.getTail({ lines: 50 });
        setLog(tail.lines);
      } catch (e) {
        setErr(friendlyCoreError(e));
      }
    })();
  }, [core]);

  const runSelfCheck = useCallback(async (): Promise<void> => {
    setErr('');
    try {
      const res = await core.diagnostics.runSelfCheck({});
      setChecks(res.results);
    } catch (e) {
      setErr(friendlyCoreError(e));
    }
  }, [core]);

  const checkRoute = useCallback(async (): Promise<void> => {
    setErr('');
    try {
      const res = await core.diagnostics.checkRoute({ address: addr });
      setRouteOut(String(res.outbound));
    } catch (e) {
      setErr(friendlyCoreError(e));
    }
  }, [core, addr]);

  const publicIp = useCallback(async (): Promise<void> => {
    setErr('');
    try {
      const res = await core.diagnostics.getPublicIp({});
      setIp(res.ip ?? '—');
    } catch (e) {
      setErr(friendlyCoreError(e));
    }
  }, [core]);

  return (
    <div className="diag">
      {err !== '' && <div className="toast-err" role="alert">{err}</div>}

      <section className="diag-block">
        <h3>{t('chk.title')}</h3>
        <button className="btn primary" onClick={() => void runSelfCheck()}>
          {t('chk.run')}
        </button>
        <ul className="diag-list">
          {checks.map((c, i) => (
            <li key={`${String(c.kind)}-${String(i)}`} className={c.status === SelfCheckResult_Status.UNSPECIFIED ? 'muted' : ''}>
              {String(c.kind)} · {c.status === SelfCheckResult_Status.OK ? t('chk.core.ok') : t('chk.core.err')}
              {c.detail !== undefined ? ` — ${c.detail}` : ''}
            </li>
          ))}
        </ul>
      </section>

      <section className="diag-block">
        <h3>{t('chk.title')}</h3>
        <div className="srv-import-row">
          <input className="input" value={addr} onChange={(e) => { setAddr(e.target.value); }} aria-label={t('chk.routeLink')} />
          <button className="btn" onClick={() => void checkRoute()}>{t('chk.run')}</button>
          <span className="muted">{routeOut}</span>
        </div>
      </section>

      <section className="diag-block">
        <h3>{t('dns.auto')}</h3>
        <button className="btn" onClick={() => void publicIp()}>{t('chk.routeLink')}</button>
        {ip !== '' && <div className="mono">{ip}</div>}
      </section>

      <section className="diag-block">
        <h3>{t('log.copy')}</h3>
        <pre className="diag-log mono">
          {log.map((l) => `${new Date(Number(l.tsMs)).toISOString().slice(11, 19)} ${String(l.level)} ${l.message}`).join('\n')}
          {log.length === 0 ? '—' : ''}
        </pre>
      </section>
    </div>
  );
}
