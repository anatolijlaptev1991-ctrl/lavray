// SPDX-License-Identifier: GPL-3.0-only

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
import { SubscriptionProgress_Phase } from '../gen/lavray_pb';
import { ConfirmDialog } from '../components/dialogs';
import { Icon } from '../components/Icon';
import { SubscriptionSettingsDialog } from '../components/SubscriptionSettingsDialog';
import { SubscriptionCard } from './subscriptions/SubscriptionCard';
import type { SubError, SubErrKey } from './subscriptions/SubscriptionCard';
import { UpdateAllButton } from './subscriptions/UpdateAllButton';
import { openExternal } from '../lib/external';

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

/** Ошибка для карточки: ключ фразы и код; null — ошибок не было. */
function subError(stored: StoredErr | undefined): SubError | null {
  return stored === undefined ? null : { key: subErrKey(stored.code), code: stored.code };
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

/** Обновление, остановленное на вопросе «удалить N из M серверов?» (T-18). */
interface PendingConfirm {
  readonly id: bigint;
  readonly name: string;
  readonly remove: number;
  readonly total: number;
}

export function SubscriptionsScreen(): JSX.Element {
  const { t, tf, plural } = useI18n();
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

      <div className="srv-actions">
        <UpdateAllButton
          disabled={subs.length === 0}
          otherBusy={busy !== ''}
          onFinished={(text) => {
            setOk(text);
            void reload();
          }}
          onError={setErr}
        />
      </div>

      <div className="sub-grid">
        {subs.map((g) => (
          <SubscriptionCard
            key={String(g.id)}
            group={g}
            count={counts[String(g.id)] ?? g.profileOrder.length}
            error={subError(errors[String(g.id)])}
            busy={busy === String(g.id)}
            onSettings={() => {
              setSettingsFor(g);
            }}
            onOpenUrl={() => {
              openUrl(g.subscriptionUrl ?? '');
            }}
            onToggleAuto={() => void toggleAuto(g)}
            onUpdate={() => void update(g.id, g.name)}
            onDelete={() => {
              setPendingDelete({ id: g.id, name: g.name, count: counts[String(g.id)] ?? g.profileOrder.length });
            }}
            onRolledBack={(text) => {
              setOk(text);
              void reload();
            }}
          />
        ))}

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
