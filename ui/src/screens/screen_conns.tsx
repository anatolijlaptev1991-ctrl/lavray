// screen_conns.tsx — «Соединения» (DS §8, FR-UI-274/271/213): активные и
// недавно закрытые соединения, фильтр по адресу/исходящему, закрытие,
// создание правил «напрямую/через прокси».
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Connection } from '../gen/lavray_pb';
import { Connection_Status } from '../gen/lavray_pb';
import { friendlyCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { formatDuration } from '../lib/i18n';
import { Icon } from '../components/Icon';

export function ConnsScreen(): JSX.Element {
  const { t, tf, lang } = useI18n();
  const core = useCore();
  const [list, setList] = useState<Connection[]>([]);
  const [query, setQuery] = useState('');
  const [err, setErr] = useState('');
  const [truncated, setTruncated] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return list;
    return list.filter(
      (c) =>
        c.destination.toLowerCase().includes(q) ||
        c.outbound.toLowerCase().includes(q) ||
        (c.rule ?? '').toLowerCase().includes(q) ||
        (c.process ?? '').toLowerCase().includes(q),
    );
  }, [list, query]);

  const close = useCallback(
    async (id: string): Promise<void> => {
      setErr('');
      try {
        await core.connections.closeConnection({ id });
        setList((prev) => prev.filter((c) => c.id !== id));
      } catch (e) {
        setErr(friendlyCoreError(e));
      }
    },
    [core],
  );

  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    void (async (): Promise<void> => {
      try {
        const stream = core.connections.watchConnections(
          { intervalMs: 1000, activePageLimit: 500 },
          { signal: ac.signal },
        );
        for await (const snap of stream) {
          setList(snap.active);
          setTruncated(snap.truncated);
        }
      } catch (e) {
        if (!ac.signal.aborted) setErr(friendlyCoreError(e));
      }
    })();
    return (): void => {
      ac.abort();
    };
  }, [core]);

  return (
    <div className="conns">
      {err !== '' && (
        <div className="banner banner-err" role="alert">
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="bn-t">{err}</div>
        </div>
      )}

      <div className="log-toolbar">
        <div className="searchwrap">
          <input
            className="input"
            placeholder={t('conns.search')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            aria-label={t('conns.search')}
          />
        </div>
        <span className="cap">{tf('conns.count', { n: filtered.length })}</span>
        {truncated && <span className="badge badge-warn">{t('conns.empty')}</span>}
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <Icon name="activity" />
          <div className="empty-t">{t('conns.caption')}</div>
          <div className="empty-d">{t('conns.empty')}</div>
        </div>
      ) : (
        <div className="log-wrap">
          <table className="conns-table">
            <thead>
              <tr>
                <th>{t('conns.col.app')}</th>
                <th>{t('conns.col.host')}</th>
                <th>{t('conns.col.out')}</th>
                <th>{t('conns.col.rule')}</th>
                <th>{t('conns.col.dur')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const active = c.status === Connection_Status.ACTIVE;
                const started = Number(c.startedAtMs);
                const ended = c.endedAtMs !== undefined ? Number(c.endedAtMs) : Date.now();
                return (
                  <tr key={c.id} className={active ? '' : 'muted'}>
                    <td className="mono">{c.process ?? '—'}</td>
                    <td className="mono" title={c.resolvedDestination ?? c.destination}>
                      {c.destination}
                    </td>
                    <td className="mono">{c.outbound}</td>
                    <td className="mono">{c.rule ?? '—'}</td>
                    <td className="mono">{formatDuration(ended - started, lang)}</td>
                    <td>
                      {active && (
                        <button
                          className="btn btn-ic btn-sm"
                          aria-label={t('conns.close')}
                          title={t('conns.close')}
                          onClick={() => void close(c.id)}
                        >
                          <Icon name="x" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
