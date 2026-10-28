// screen_subscriptions.tsx — «Подписки» по прототипу v1.2 (DS §8,
// FR-UI-250…263): карточки сеткой, URL, счётчик серверов, трафик за месяц
// с прогрессом, срок действия, автообновление (switch), обновление со
// стримом прогресса, состояния ошибок (401/403/404/timeout/0 серверов).
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Group } from '../gen/lavray_pb';
import { showCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { formatBytes, NB } from '../lib/i18n';
import { SubscriptionProgress_Phase } from '../gen/lavray_pb';
import { Icon } from '../components/Icon';

/** Состояние ошибки подписки → ключ словаря (как subErrParts прототипа). */
function subErrKey(
  err: string,
): 'sub.err.auth' | 'sub.err.notFound' | 'sub.err.timeout' | 'sub.err.zero' | null {
  const code = err.trim();
  if (code === '') return null;
  if (code.startsWith('401') || code.startsWith('403') || /unauthor|forbidden/i.test(code))
    return 'sub.err.auth';
  if (code.startsWith('404') || /not found/i.test(code)) return 'sub.err.notFound';
  if (/timeout|deadline|не ответил/i.test(code)) return 'sub.err.timeout';
  if (/0 (профил|сервер|профилей)|zero/i.test(code)) return 'sub.err.zero';
  return null;
}

function relDate(ms: number, lang: string): string {
  const diff = ms - Date.now();
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 3600e3) return rtf.format(Math.round(diff / 60e3), 'minute');
  if (abs < 864e5) return rtf.format(Math.round(diff / 3600e3), 'hour');
  return rtf.format(Math.round(diff / 864e5), 'day');
}

export function SubscriptionsScreen(): JSX.Element {
  const { t, tf, lang } = useI18n();
  const core = useCore();
  const [subs, setSubs] = useState<Group[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await core.subscriptions.listSubscriptions({});
      setSubs(res.groups);
      const next: Record<string, number> = {};
      await Promise.all(
        res.groups.map(async (g) => {
          try {
            const list = await core.profiles.listProfiles({
              groupId: g.id,
              page: { limit: 1, offset: 0n },
            });
            next[String(g.id)] = Number(list.total);
          } catch {
            next[String(g.id)] = g.profileOrder.length;
          }
        }),
      );
      setCounts(next);
    } catch (e) {
      setErr(showCoreError(e, t));
    }
  }, [core, t]);

  useEffect(() => {
    void reload();
  }, [reload, t]);

  const add = useCallback(async (): Promise<void> => {
    setErr('');
    setOk('');
    const clean = url.trim();
    if (clean === '') {
      setErr(t('sub.err.notFound'));
      return;
    }
    setBusy('add');
    try {
      const autoName = ((): string => {
        try {
          return new URL(clean).host;
        } catch {
          return '';
        }
      })();
      const g = await core.subscriptions.createSubscription({
        name: name.trim() === '' ? autoName : name.trim(),
        url: clean,
      });
      setOk(tf('toast.subUpdated', { name: g.name }));
      setUrl('');
      setName('');
      setAdding(false);
      await reload();
    } catch (e) {
      setErr(showCoreError(e, t));
    } finally {
      setBusy('');
    }
  }, [core, url, name, t, tf, reload]);

  const update = useCallback(
    async (id: bigint, gname: string): Promise<void> => {
      setErr('');
      setOk('');
      setProgress(t('scr.subs.sub'));
      setBusy(String(id));
      try {
        // D4 (аудит round 2): успех показываем ТОЛЬКО при PHASE_DONE. При
        // CONFIRM_REQUIRED раньше всё равно висел тост «обновлено», а
        // деструктивное обновление нельзя было подтвердить из UI.
        const attempt = async (confirm: boolean): Promise<{ done: boolean; needConfirm: boolean }> => {
          let done = false;
          let needConfirm = false;
          let wouldRemove = 0;
          let total = 0;
          const stream = core.subscriptions.updateSubscription({
            groupId: id,
            confirmDestructive: confirm,
          });
          for await (const ev of stream) {
            if (ev.phase === SubscriptionProgress_Phase.CONFIRM_REQUIRED) {
              needConfirm = true;
              wouldRemove = ev.wouldRemoveCount ?? 0;
              total = ev.totalCount ?? 0;
            } else if (ev.phase === SubscriptionProgress_Phase.FAILED) {
              setErrors((m) => ({ ...m, [String(id)]: ev.detail ?? 'error' }));
            } else if (ev.phase === SubscriptionProgress_Phase.DONE) {
              done = true;
            } else {
              setProgress(ev.detail ?? '');
            }
          }
          if (needConfirm && !confirm) {
            const okConfirm = window.confirm(
              `${t('sub.err.badge')}: ${String(wouldRemove)} / ${String(total)}`,
            );
            if (okConfirm) {
              return attempt(true);
            }
          }
          return { done, needConfirm };
        };
        const res = await attempt(false);
        if (res.done) {
          setErrors((m) => {
            const next: Record<string, string> = {};
            for (const [k, v] of Object.entries(m)) {
              if (k !== String(id)) next[k] = v;
            }
            return next;
          });
          setOk(tf('toast.subUpdated', { name: gname }));
          await reload();
        } else if (!res.needConfirm) {
          setErr(t('sub.err.badge'));
        }
      } catch (e) {
        const msg = showCoreError(e, t);
        setErrors((m) => ({ ...m, [String(id)]: msg }));
        setErr(msg);
      } finally {
        setBusy('');
        setProgress('');
      }
    },
    [core, t, tf, reload],
  );

  const toggleAuto = useCallback(
    async (g: Group): Promise<void> => {
      try {
        // D5 (аудит round 2): UpdateGroup — полная замена; отправляем
        // исходную группу с изменённым флагом, иначе терялись URL, UA,
        // заголовки и интервал подписки.
        await core.profiles.updateGroup({
          group: { ...g, skipAutoUpdate: !g.skipAutoUpdate },
        });
        await reload();
      } catch (e) {
        setErr(showCoreError(e, t));
      }
    },
    [core, reload, t],
  );

  const remove = useCallback(
    async (id: bigint): Promise<void> => {
      setErr('');
      try {
        await core.subscriptions.deleteSubscription({ groupId: id });
        await reload();
      } catch (e) {
        setErr(showCoreError(e, t));
      }
    },
    [core, reload, t],
  );

  const openUrl = useCallback((raw: string): void => {
    if (raw !== '') window.open(raw, '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <div className="subs">
      {err !== '' && (
        <div className="banner banner-err" role="alert">
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="bn-t">{err}</div>
        </div>
      )}
      {ok !== '' && <div className="toast-ok">{ok}</div>}
      {progress !== '' && <div className="toast-ok">{progress}</div>}

      <div className="sub-grid">
        {subs.map((g) => {
          const info = g.subscriptionInfo;
          const used = Number(info?.uploadBytes ?? 0n) + Number(info?.downloadBytes ?? 0n);
          const limit = Number(info?.totalBytes ?? 0n);
          const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
          const expire = info?.expireMs !== undefined ? Number(info.expireMs) : 0;
          const soon = expire > 0 && expire - Date.now() < 3 * 864e5;
          const ekey = subErrKey(errors[String(g.id)] ?? '');
          const isBusy = busy === String(g.id);
          return (
            <article key={String(g.id)} className="card sub-card">
              <div className="sub-top">
                <h3 title={g.name}>{g.name}</h3>
                {ekey !== null && (
                  <span className="badge badge-err">
                    <span className="dot err" />
                    {t('sub.err.badge')}
                  </span>
                )}
                <span className="flex1" />
                <button
                  className="btn btn-ic btn-sm"
                  aria-label={t('common.open')}
                  title={t('common.open')}
                  onClick={() => {
                    openUrl(g.subscriptionUrl ?? '');
                  }}
                >
                  <Icon name="external" />
                </button>
              </div>

              <div className="sub-url" title={g.subscriptionUrl ?? ''}>
                {g.subscriptionUrl ?? ''}
              </div>

              <div className="sub-meta">
                <div className="row">
                  <span className="k">{t('nav.servers')}</span>
                  <span>{String(counts[String(g.id)] ?? 0)}</span>
                </div>
                <div className="row">
                  <span className="k">{t('subs.lastUp')}</span>
                  <span>
                    {g.lastUpdateMs !== undefined ? relDate(Number(g.lastUpdateMs), lang) : '—'}
                  </span>
                </div>
                <div className="row">
                  <span className="k">{t('subs.expiry')}</span>
                  <span>
                    {expire > 0 ? (
                      <>
                        {tf('sub.expires', { when: relDate(expire, lang) })}
                        {soon && (
                          <span className="badge badge-warn" style={{ marginInlineStart: 6 }}>
                            {t('sub.expiresSoon')}
                          </span>
                        )}
                      </>
                    ) : (
                      t('sub.noExpiry')
                    )}
                  </span>
                </div>
              </div>

              {ekey !== null && (
                <div className="sub-errline">
                  <Icon name="alert" />
                  <span>
                    {t(ekey)}{' '}
                    <span className="cap mono">({errors[String(g.id)] ?? ''})</span>
                  </span>
                </div>
              )}

              <div className="sub-traffic">
                <div className="row">
                  <span className="k">{t('subs.traffic')}</span>
                  <b>
                    ↓ {formatBytes(Number(info?.downloadBytes ?? 0n), lang)} · ↑{' '}
                    {formatBytes(Number(info?.uploadBytes ?? 0n), lang)}
                  </b>
                </div>
                <div className="progress">
                  <div style={{ width: `${String(pct)}%` }} />
                </div>
                <span className="cap">
                  {limit > 0
                    ? `${formatBytes(used, lang)}${NB}${t('subs.of')}${NB}${formatBytes(limit, lang)}`
                    : t('sub.unlimited')}
                </span>
              </div>

              <div className="sub-foot">
                <div className="sub-auto">
                  <span>{t('subs.auto')}</span>
                  <button
                    className={`sw${g.skipAutoUpdate ? '' : ' on'}`}
                    role="switch"
                    aria-checked={!g.skipAutoUpdate}
                    aria-label={t('subs.auto')}
                    onClick={() => void toggleAuto(g)}
                  />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className={`btn btn-sec btn-sm${isBusy ? ' loading' : ''}`}
                    aria-label={t('common.refresh')}
                    title={t('common.refresh')}
                    disabled={isBusy}
                    onClick={() => void update(g.id, g.name)}
                  >
                    <Icon name="refresh" />
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    aria-label={t('srv.delSel')}
                    title={t('srv.delSel')}
                    onClick={() => void remove(g.id)}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
            </article>
          );
        })}

        {adding ? (
          <article className="card sub-card">
            <div className="sub-top">
              <h3>{t('subs.add')}</h3>
            </div>
            <input
              className="input"
              placeholder="https://provider.example/sub"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
              }}
              aria-label={t('imp.link')}
            />
            <input
              className="input"
              placeholder={t('imp.name')}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              aria-label={t('imp.name')}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="btn btn-pri btn-sm"
                onClick={() => void add()}
                disabled={busy !== ''}
              >
                {t('imp.do')}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setAdding(false);
                }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </article>
        ) : (
          <button
            className="sub-add"
            onClick={() => {
              setAdding(true);
            }}
          >
            <Icon name="plus" />
            <span>{t('subs.add')}</span>
          </button>
        )}
      </div>
    </div>
  );
}
