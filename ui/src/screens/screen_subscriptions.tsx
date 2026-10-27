// screen_subscriptions.tsx — «Подписки» (DS §8, FR-UI-250…263): список
// подписок, добавление по URL, обновление (стрим прогресса), удаление.
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { friendlyCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import type { Group } from '../gen/lavray_pb';
import { useI18n } from '../hooks/useI18n';

export function SubscriptionsScreen(): JSX.Element {
  const { t } = useI18n();
  const core = useCore();
  const [subs, setSubs] = useState<Group[]>([]);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await core.subscriptions.listSubscriptions({});
      setSubs(res.groups);
    } catch (e) {
      setErr(friendlyCoreError(e));
    }
  }, [core]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = useCallback(async (): Promise<void> => {
    setErr('');
    setOk('');
    const clean = url.trim();
    if (clean === '') {
      setErr(t('menu.file.import'));
      return;
    }
    setBusy(true);
    try {
      const g = await core.subscriptions.createSubscription({
        name: name.trim(),
        url: clean,
      });
      setOk(`${t('toast.subUpdated')}: ${g.name}`);
      setUrl('');
      setName('');
      await reload();
    } catch (e) {
      setErr(friendlyCoreError(e));
    } finally {
      setBusy(false);
    }
  }, [core, url, name, t, reload]);

  const update = useCallback(
    async (id: bigint): Promise<void> => {
      setErr('');
      setOk('');
      setProgress(t('scr.subs.sub'));
      setBusy(true);
      try {
        const stream = core.subscriptions.updateSubscription({ groupId: id });
        for await (const ev of stream) {
          const p = ev;
          setProgress(p.detail ?? (String(p.phase) + " +" + String(p.addedCount ?? 0)));
        }
        setOk(t('toast.subUpdated'));
        await reload();
      } catch (e) {
        setErr(friendlyCoreError(e));
      } finally {
        setBusy(false);
        setProgress('');
      }
    },
    [core, t, reload],
  );

  const remove = useCallback(
    async (id: bigint): Promise<void> => {
      setErr('');
      try {
        await core.subscriptions.deleteSubscription({ groupId: id });
        await reload();
      } catch (e) {
        setErr(friendlyCoreError(e));
      }
    },
    [core, reload],
  );

  return (
    <div className="subs">
      <div className="sub-add">
        <input
          className="input"
          placeholder={t('menu.file.import')}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
          }}
          aria-label={t('menu.file.import')}
        />
        <input
          className="input narrow"
          placeholder={t('imp.name')}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          aria-label={t('imp.name')}
        />
        <button className="btn primary" onClick={() => void add()} disabled={busy}>
          {t('imp.do')}
        </button>
      </div>

      {progress !== '' && <div className="toast-ok">{progress}</div>}
      {ok !== '' && <div className="toast-ok">{ok}</div>}
      {err !== '' && (
        <div className="toast-err" role="alert">
          {err}
        </div>
      )}

      <ul className="subs-list">
        {subs.map((g) => (
          <li key={String(g.id)} className="sub-row">
            <div className="sub-main">
              <span className="sub-name">{g.name}</span>
              <span className="muted mono sub-url">{g.subscriptionUrl}</span>
            </div>
            <span className="muted">
              {g.lastUpdateMs ? new Date(Number(g.lastUpdateMs)).toLocaleDateString() : '—'}
            </span>
            <button className="btn" onClick={() => void update(g.id)} disabled={busy}>
              {t('imp.do')}
            </button>
            <button className="btn ghost" onClick={() => void remove(g.id)} aria-label={t('srv.delSel')}>
              ✕
            </button>
          </li>
        ))}
        {subs.length === 0 && <li className="muted">{t('cx.empty.d')}</li>}
      </ul>
    </div>
  );
}
