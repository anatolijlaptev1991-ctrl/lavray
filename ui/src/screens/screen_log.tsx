// SPDX-License-Identifier: GPL-3.0-only

// screen_log.tsx — «Журнал» по прототипу v1.2 (DS §8, FR-UI-210…218):
// живой поток через SubscribeLogs (tail + стрим), фильтр по уровню,
// поиск, автопрокрутка, копирование (ядро уже редактирует секреты).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { LogLine } from '../gen/lavray_pb';
import { LogLevel } from '../gen/lavray_pb';
import { CORE_UNAVAILABLE, friendlyCoreError, showCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { Icon } from '../components/Icon';

interface LevelOption {
  readonly level: LogLevel;
  readonly label: string;
}

const LEVELS: readonly LevelOption[] = [
  { level: LogLevel.TRACE, label: 'TRACE' },
  { level: LogLevel.DEBUG, label: 'DEBUG' },
  { level: LogLevel.INFO, label: 'INFO' },
  { level: LogLevel.WARN, label: 'WARN' },
  { level: LogLevel.ERROR, label: 'ERROR' },
];

const LEVEL_LABEL: Record<number, string> = {
  [LogLevel.TRACE]: 'TRACE',
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

const MAX_LINES = 2000;
/** Сколько строк истории ядро отдаёт сразу при подписке. */
const TAIL_LINES = 200;

export function LogScreen(): JSX.Element {
  const { t, lang } = useI18n();
  const core = useCore();
  const [lines, setLines] = useState<LogLine[]>([]);
  // «Пауза» (прототип #logPause): список замораживается снимком, новые строки
  // продолжают копиться в lines и появляются после «Продолжить».
  const [frozen, setFrozen] = useState<LogLine[] | null>(null);
  const [streamErr, setStreamErr] = useState('');
  const [minLevel, setMinLevel] = useState<LogLevel>(LogLevel.INFO);
  const [query, setQuery] = useState('');
  const [autoscroll, setAutoscroll] = useState(true);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const viewRef = useRef<HTMLDivElement | null>(null);

  // T-70: один источник строк. Подписка сама отдаёт историю (tail_lines) и
  // затем новые строки одним упорядоченным потоком — отдельный GetTail давал
  // дубли. Все уровни приходят один раз; уровень и поиск применяются при
  // показе, поэтому смена уровня мгновенна и не переподписывается.
  useEffect(() => {
    const abort = new AbortController();
    setLines([]);
    void (async (): Promise<void> => {
      try {
        const stream = core.logs.subscribe({ tailLines: TAIL_LINES }, { signal: abort.signal });
        for await (const line of stream) {
          if (abort.signal.aborted) return;
          setLines((prev) => {
            const next = prev.length >= MAX_LINES ? prev.slice(prev.length - MAX_LINES + 1) : prev;
            return [...next, line];
          });
        }
      } catch (e) {
        if (!abort.signal.aborted) setStreamErr(friendlyCoreError(e));
      }
    })();
    return (): void => {
      abort.abort();
    };
  }, [core]);

  const source = frozen ?? lines;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return source.filter(
      (l) =>
        l.level >= minLevel &&
        (q === '' || l.message.toLowerCase().includes(q) || l.source.toLowerCase().includes(q)),
    );
  }, [source, minLevel, query]);

  useEffect(() => {
    if (!autoscroll) return;
    const el = viewRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [filtered, autoscroll]);

  const togglePause = useCallback((): void => {
    setFrozen((f) => (f === null ? lines : null));
  }, [lines]);

  const copy = useCallback(async (): Promise<void> => {
    setErr('');
    try {
      const text = filtered
        .map((l) => `${new Date(Number(l.tsMs)).toISOString()} ${LEVEL_LABEL[l.level] ?? 'INFO'} ${l.source}: ${l.message}`)
        .join('\n');
      await navigator.clipboard.writeText(text);
      setOk(t('toast.logCopied'));
    } catch (e) {
      setErr(showCoreError(e, t));
    }
  }, [filtered, t]);

  const download = useCallback((): void => {
    const text = filtered
      .map((l) => `${new Date(Number(l.tsMs)).toISOString()} ${LEVEL_LABEL[l.level] ?? 'INFO'} ${l.source}: ${l.message}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lavray-log-${String(Date.now())}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [filtered]);

  return (
    <div className="log">
      {(err !== '' || streamErr !== '') && (
        <div className="banner banner-err" role="alert">
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="bn-t">
            {err !== '' ? err : streamErr === CORE_UNAVAILABLE ? t(CORE_UNAVAILABLE) : streamErr}
          </div>
        </div>
      )}
      {ok !== '' && <div className="toast-ok" role="status">{ok}</div>}

      <div className="log-toolbar">
        <div className="searchwrap">
          <input
            className="input"
            placeholder={t('log.searchPh')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            aria-label={t('log.searchPh')}
          />
        </div>
        <select
          className="select"
          value={String(minLevel)}
          onChange={(e) => {
            const chosen = LEVELS.find((l) => String(l.level) === e.target.value);
            if (chosen !== undefined) setMinLevel(chosen.level);
          }}
          aria-label={t('log.all')}
          style={{ width: 'auto' }}
        >
          {LEVELS.map((l) => (
            <option key={l.label} value={String(l.level)}>
              {l.label}
            </option>
          ))}
        </select>
        <label className="sub-auto" style={{ gap: 6 }}>
          <span>{t('log.autoscroll')}</span>
          <button
            className={`sw${autoscroll ? ' on' : ''}`}
            role="switch"
            aria-checked={autoscroll}
            aria-label={t('log.autoscroll')}
            onClick={() => {
              setAutoscroll((v) => !v);
            }}
          />
        </label>
        <span className="flex1" />
        <button className="btn btn-sec btn-sm" onClick={() => void copy()}>
          <Icon name="copy" />
          <span>{t('log.copy')}</span>
        </button>
        <button className="btn btn-ghost btn-sm" onClick={download}>
          {t('log.export')}
        </button>
      </div>

      <div className="log-wrap">
        <div className="log-head">
          <button
            className={`btn btn-sm ${frozen === null ? 'btn-ghost' : 'btn-sec'}`}
            onClick={togglePause}
          >
            <Icon name={frozen === null ? 'pause' : 'play'} />
            <span>{frozen === null ? t('log.pause') : t('log.resume')}</span>
          </button>
          <span className="flex1" />
          <span className="cap">{t('log.exportD')}</span>
        </div>
        <div id="logView" ref={viewRef} role="log" aria-live="polite">
          {filtered.map((l, i) => (
            <div key={`${String(l.tsMs)}-${String(i)}`} className="log-l">
              <span className="lt">
                {new Date(Number(l.tsMs)).toLocaleTimeString(lang, { hour12: false })}
              </span>
              <span className="lt" style={{ minWidth: 48 }}>
                {LEVEL_LABEL[l.level] ?? 'INFO'}
              </span>
              <span className="lt" style={{ minWidth: 56 }}>
                {l.source}
              </span>
              <span>{l.message}</span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="muted">{t(source.length > 0 ? 'log.noMatch' : 'log.none')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
