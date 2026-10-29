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
import { ConfirmDialog } from '../components/dialogs';
import { Icon } from '../components/Icon';
import { SubscriptionSettingsDialog } from '../components/SubscriptionSettingsDialog';
import { openExternal } from '../lib/external';

type SubErrKey =
  | 'sub.err.auth'
  | 'sub.err.notFound'
  | 'sub.err.timeout'
  | 'sub.err.zero'
  | 'sub.err.generic';

/**
 * Текст ошибки обновления → короткий код, как sub.error прототипа: HTTP-статус,
 * timeout, zero или error. Сам текст не сохраняется: в нём бывает ссылка с токеном.
 */
function subErrCode(raw: string): string {
  const s = raw.trim();
  const status = /HTTP\s+(\d{3})/i.exec(s)?.[1] ?? /^(\d{3})\b/.exec(s)?.[1];
  if (status !== undefined) return status;
  if (/unauthor/i.test(s)) return '401';
  if (/forbidden/i.test(s)) return '403';
  if (/not found/i.test(s)) return '404';
  if (/timeout|deadline|не ответил/i.test(s)) return 'timeout';
  if (/0 (профил|сервер|профилей)|zero/i.test(s)) return 'zero';
  return 'error';
}

/** Код ошибки → ключ словаря (как subErrParts прототипа). */
function subErrKey(code: string): SubErrKey {
  if (code === '401' || code === '403') return 'sub.err.auth';
  if (code === '404') return 'sub.err.notFound';
  if (code === 'timeout') return 'sub.err.timeout';
  if (code === 'zero') return 'sub.err.zero';
  return 'sub.err.generic';
}

/**
 * Ошибка последнего обновления подписки (T-68). В Group поля ошибки нет, поэтому
 * экран хранит её сам: после возврата на вкладку и перезапуска карточка
 * по-прежнему показывает, что обновление не удалось.
 */
interface StoredErr {
  readonly code: string;
  readonly at: number;
}

const ERR_STORE = 'lavray.subErrors';

function isStoredErr(v: unknown): v is StoredErr {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as StoredErr).code === 'string' &&
    typeof (v as StoredErr).at === 'number'
  );
}

function loadErrors(): Record<string, StoredErr> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ERR_STORE) ?? '{}') as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => isStoredErr(v)));
  } catch {
    return {};
  }
}

function saveErrors(errors: Record<string, StoredErr>): void {
  try {
    window.localStorage.setItem(ERR_STORE, JSON.stringify(errors));
  } catch {
    /* приватный режим: ошибка живёт до закрытия экрана */
  }
}

/**
 * Когда подписка обновится в следующий раз: последнее обновление + интервал
 * (свой, иначе рекомендованный провайдером). null — автообновления нет.
 */
function nextUpdateMs(g: Group): number | null {
  if (g.skipAutoUpdate || g.lastUpdateMs === undefined) return null;
  const own = g.updateIntervalMin ?? 0;
  const minutes = own > 0 ? own : (g.subscriptionInfo?.updateIntervalHours ?? 0) * 60;
  return minutes > 0 ? Number(g.lastUpdateMs) + minutes * 60e3 : null;
}

function relDate(ms: number, lang: string): string {
  const diff = ms - Date.now();
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 3600e3) return rtf.format(Math.round(diff / 60e3), 'minute');
  if (abs < 864e5) return rtf.format(Math.round(diff / 3600e3), 'hour');
  return rtf.format(Math.round(diff / 864e5), 'day');
}

/** Обновление, остановленное на вопросе «удалить N из M серверов?» (T-18). */
interface PendingConfirm {
  readonly id: bigint;
  readonly name: string;
  readonly remove: number;
  readonly total: number;
}

export function SubscriptionsScreen(): JSX.Element {
  const { t, tf, plural, lang } = useI18n();
  const core = useCore();
  const [subs, setSubs] = useState<Group[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, StoredErr>>(loadErrors);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [adding, setAdding] = useState(false);
  // T-12: подписка, ожидающая подтверждения удаления (RPC — только после «Удалить»).
  const [pendingDelete, setPendingDelete] = useState<{
    id: bigint;
    name: string;
    count: number;
  } | null>(null);
  // T-18: обновление, ожидающее подтверждения «удалит N из M серверов».
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [settingsFor, setSettingsFor] = useState<Group | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await core.subscriptions.listSubscriptions({});
      setSubs(res.groups);
      const alive = new Set(res.groups.map((g) => String(g.id)));
      setErrors((m) => {
        const kept = Object.entries(m).filter(([id]) => alive.has(id));
        return kept.length === Object.keys(m).length ? m : Object.fromEntries(kept);
      });
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

  useEffect(() => {
    saveErrors(errors);
  }, [errors]);

  const noteError = useCallback((id: bigint, raw: string): void => {
    setErrors((m) => ({ ...m, [String(id)]: { code: subErrCode(raw), at: Date.now() } }));
  }, []);

  const dropError = useCallback((id: bigint): void => {
    setErrors((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== String(id))));
  }, []);

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
      // CreateSubscription создаёт только пустую группу, серверы не загружает:
      // «обновлена» было бы неправдой (B1-25).
      setOk(tf('toast.subAdded', { name: g.name }));
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
    async (id: bigint, gname: string, confirm = false): Promise<void> => {
      setErr('');
      setOk('');
      setProgress(t('scr.subs.sub'));
      setBusy(String(id));
      try {
        // D4 (аудит round 2): успех показываем ТОЛЬКО при PHASE_DONE.
        // T-18: кадр CONFIRM_REQUIRED — не ошибка, а вопрос пользователю
        // «Обновление удалит N из M серверов. Продолжить?». Ядро закрывает
        // поток штатно; по «Обновить» вызов повторяется с confirmDestructive.
        let done = false;
        let wouldRemove: number | null = null;
        try {
          const stream = core.subscriptions.updateSubscription({
            groupId: id,
            confirmDestructive: confirm,
          });
          for await (const ev of stream) {
            if (ev.phase === SubscriptionProgress_Phase.CONFIRM_REQUIRED) {
              wouldRemove = ev.wouldRemoveCount ?? 0;
            } else if (ev.phase === SubscriptionProgress_Phase.FAILED) {
              noteError(id, ev.detail ?? '');
            } else if (ev.phase === SubscriptionProgress_Phase.DONE) {
              done = true;
            } else {
              setProgress(ev.detail ?? '');
            }
          }
        } catch (e) {
          // Ядро до T-18 закрывало поток ошибкой после CONFIRM_REQUIRED: кадр
          // уже получен, то есть это запрос подтверждения, а не сбой.
          if (wouldRemove === null) throw e;
        }
        if (wouldRemove !== null && !confirm) {
          setPending({
            id,
            name: gname,
            remove: wouldRemove,
            total: Math.max(counts[String(id)] ?? 0, wouldRemove),
          });
        } else if (done) {
          dropError(id);
          setOk(tf('toast.subUpdated', { name: gname }));
          await reload();
        } else {
          setErr(t('sub.err.badge'));
        }
      } catch (e) {
        // Код берём из сырого текста: showCoreError подменяет «HTTP 404» в
        // сообщении ответа провайдера на «Ядро недоступно».
        noteError(id, e instanceof Error ? e.message : String(e));
        setErr(showCoreError(e, t));
      } finally {
        setBusy('');
        setProgress('');
      }
    },
    [core, t, tf, reload, counts, noteError, dropError],
  );

  const confirmPending = useCallback((): void => {
    if (pending === null) return;
    setPending(null);
    void update(pending.id, pending.name, true);
  }, [pending, update]);

  const closePending = useCallback((): void => {
    setPending(null);
  }, []);

  const closeSettings = useCallback((): void => {
    setSettingsFor(null);
  }, []);

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
        dropError(id);
        await reload();
      } catch (e) {
        setErr(showCoreError(e, t));
      }
    },
    [core, reload, t, dropError],
  );

  const openUrl = useCallback((raw: string): void => {
    // В окне Tauri window.open молча гасится — открываем через оболочку (T-58).
    if (raw !== '') void openExternal(raw);
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
      {ok !== '' && <div className="toast-ok" role="status">{ok}</div>}
      {progress !== '' && <div className="toast-ok" role="status">{progress}</div>}

      <div className="sub-grid">
        {subs.map((g) => {
          const info = g.subscriptionInfo;
          const used = Number(info?.uploadBytes ?? 0n) + Number(info?.downloadBytes ?? 0n);
          const limit = Number(info?.totalBytes ?? 0n);
          const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
          const expire = info?.expireMs !== undefined ? Number(info.expireMs) : 0;
          const soon = expire > 0 && expire - Date.now() < 3 * 864e5;
          const lastErr = errors[String(g.id)];
          const ekey = lastErr === undefined ? null : subErrKey(lastErr.code);
          const nextAt = nextUpdateMs(g);
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
                  aria-label={t('sub.settings')}
                  title={t('sub.settings')}
                  onClick={() => {
                    setSettingsFor(g);
                  }}
                >
                  <Icon name="settings" />
                </button>
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
                {ekey === null && (
                  <div className="row">
                    <span className="k">{t('subs.next')}</span>
                    <span>{nextAt === null ? '—' : relDate(Math.max(nextAt, Date.now()), lang)}</span>
                  </div>
                )}
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

              {lastErr !== undefined && ekey !== null && (
                <div className="sub-errline">
                  <Icon name="alert" />
                  <span>
                    {t(ekey)}
                    {lastErr.code !== 'error' && (
                      <>
                        {' '}
                        <span className="cap mono">({lastErr.code})</span>
                      </>
                    )}
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
                    aria-label={t('subs.delete')}
                    title={t('subs.delete')}
                    onClick={() => {
                      setPendingDelete({
                        id: g.id,
                        name: g.name,
                        count: counts[String(g.id)] ?? g.profileOrder.length,
                      });
                    }}
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

      {pendingDelete !== null && (
        <ConfirmDialog
          title={t('subs.delete')}
          text={tf('subs.delConfirm', { name: pendingDelete.name, n: pendingDelete.count })}
          confirmLabel={t('subs.delete')}
          danger
          onConfirm={() => {
            const id = pendingDelete.id;
            setPendingDelete(null);
            void remove(id);
          }}
          onClose={() => {
            setPendingDelete(null);
          }}
        />
      )}
      {pending !== null && (
        <ConfirmDialog
          title={tf('sub.confirm.t', { name: pending.name })}
          text={plural('pl.subDel', pending.total).split('{k}').join(String(pending.remove))}
          confirmLabel={t('common.refresh')}
          danger
          onConfirm={confirmPending}
          onClose={closePending}
        />
      )}

      {settingsFor !== null && (
        <SubscriptionSettingsDialog
          group={settingsFor}
          onClose={closeSettings}
          onSaved={() => {
            void reload();
          }}
        />
      )}
    </div>
  );
}
