// SPDX-License-Identifier: GPL-3.0-only

// RouteTester.tsx — «Проверить маршрут» (CheckRoute): адрес или приложение →
// куда пойдёт и по какому правилу. Примеры запросов подставляются кликом.
import { useCallback, useState } from 'react';
import type { JSX } from 'react';
import { Outbound } from '../../gen/lavray_pb';
import { Icon } from '../../components/Icon';
import { useCore } from '../../hooks/useCore';
import { useI18n } from '../../hooks/useI18n';
import { showCoreError } from '../../lib/core';

/** Примеры для тестера маршрута (прототип #rtSugg). */
const ROUTE_SUGGESTIONS = [
  'lori.ru',
  'chat.openai.com',
  'store.steampowered.com',
  'example.org',
  '192.168.1.10',
  'cursor.exe',
] as const;

interface RouteResult {
  readonly outbound: string;
  readonly rule: string | null;
}

export function RouteTester(): JSX.Element {
  const { t } = useI18n();
  const core = useCore();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<RouteResult | null>(null);
  const [err, setErr] = useState('');
  const [testing, setTesting] = useState(false);

  const outboundName = useCallback(
    (o: Outbound): string => {
      if (o === Outbound.PROXY) return t('out.proxy');
      if (o === Outbound.DIRECT) return t('out.direct');
      return o === Outbound.BLOCK ? t('out.block') : '—';
    },
    [t],
  );

  const check = useCallback(
    async (override?: string): Promise<void> => {
      const q = (override ?? query).trim();
      if (q === '') return;
      setErr('');
      setTesting(true);
      setResult(null);
      try {
        // Приложение (game.exe) → process_name; иначе адрес/домен. Для процесса
        // address не заполняем (контракт: адрес — домен/IP).
        const isProcess = /\.exe$|\.app$/i.test(q);
        const res = await core.diagnostics.checkRoute(isProcess ? { processName: q } : { address: q });
        setResult({ outbound: outboundName(res.outbound), rule: res.matchedRule ?? null });
      } catch (e) {
        setErr(showCoreError(e, t));
      } finally {
        setTesting(false);
      }
    },
    [core, query, t, outboundName],
  );

  return (
    <div className="card">
      {err !== '' && (
        <div className="banner banner-err" role="alert">
          <span className="ic"><Icon name="alert" /></span>
          <div className="bn-t">{err}</div>
        </div>
      )}
      <div className="card-h">
        <span className="ic"><Icon name="search" /></span>
        <h2>{t('rt.test.t')}</h2>
      </div>
      <div className="rt-in">
        <label className="sr-only" htmlFor="rtQ">{t('rt.test.label')}</label>
        <input
          className="input input-mono"
          id="rtQ"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('rt.test.ph')}
          value={query}
          onChange={(e) => { setQuery(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void check();
          }}
        />
        <button className="btn btn-pri" onClick={() => void check()} disabled={testing}>
          {t('rt.test.run')}
        </button>
      </div>
      {/* Примеры запросов (прототип #rtSugg): клик подставляет значение и сразу проверяет маршрут. */}
      <div className="rt-sugg">
        {ROUTE_SUGGESTIONS.map((sg) => (
          <button
            key={sg}
            type="button"
            onClick={() => {
              setQuery(sg);
              void check(sg);
            }}
          >
            {sg}
          </button>
        ))}
      </div>
      <p className="rt-res" role="status" aria-live="polite">
        {result === null ? '' : `${result.outbound}${result.rule !== null ? ` · ${result.rule}` : ''}`}
      </p>
    </div>
  );
}
