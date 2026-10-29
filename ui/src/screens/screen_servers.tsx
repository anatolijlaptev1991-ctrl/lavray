// SPDX-License-Identifier: GPL-3.0-only

// screen_servers.tsx — «Серверы» по прототипу v1.2 (DS §8, FR-UI-081…099):
// вкладки групп, тулбар с поиском/фильтрами/протоколом, второй тулбар с
// плотностью/группировкой/тестом, список профилей карточками, массовое
// выделение, тест задержки с прогрессом, гео-группировка.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { CoreState, Group_Kind, ProfileType } from '../gen/lavray_pb';
import type { Profile } from '../gen/lavray_pb';
import { useCore, useCoreStatus, useProfiles } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { useKbdLabel } from '../hooks/useKbdLabel';
import { showCoreError } from '../lib/core';
import { groupByGeo } from '../lib/geo';
import { MANUAL_FILTER, groupDisplayName, importGroupId, newServerGroupId } from '../lib/groups';
import { formatMs, type MessageKey } from '../lib/i18n';
import { testRequest } from '../lib/testRequest';
import type { TestRun } from '../lib/testRequest';
import { formatFullReport, isTestDown, isTestNotApplicable, resultLabel } from '../lib/testResult';
import { ProfileEditor } from '../components/ProfileEditor';
import { ImportDialog } from '../components/ImportDialog';
import { FullTestDialog } from '../components/FullTestDialog';
import { ContextMenu } from '../components/ContextMenu';
import type { MenuAnchor } from '../components/ContextMenu';
import { ConfirmDialog, GroupsDialog } from '../components/dialogs';
import { Icon } from '../components/Icon';

/** Бейдж типа (прототип .badge.bt-*, нейтральный: цвет — только у статусов). */
interface TypeInfo {
  readonly cls: string;
  readonly label?: string;
  readonly labelKey?: MessageKey;
}

const TYPE_INFO: Record<number, TypeInfo> = {
  [ProfileType.SOCKS]: { cls: 'socks', label: 'SOCKS5' },
  [ProfileType.HTTP]: { cls: 'https', label: 'HTTPS' },
  [ProfileType.SHADOWSOCKS]: { cls: 'ss', label: 'Shadowsocks' },
  [ProfileType.TROJAN]: { cls: 'trojan', label: 'Trojan' },
  [ProfileType.VMESS]: { cls: 'vmess', label: 'VMess' },
  [ProfileType.VLESS]: { cls: 'vless', label: 'VLESS' },
  [ProfileType.HYSTERIA2]: { cls: 'hy2', label: 'Hysteria2' },
  [ProfileType.TUIC]: { cls: 'tuic', label: 'TUIC' },
  [ProfileType.CHAIN]: { cls: 'chain', labelKey: 'ed.t.chain' },
  [ProfileType.CUSTOM_OUTBOUND]: { cls: 'json', labelKey: 'ed.t.json' },
  [ProfileType.CUSTOM_CONFIG]: { cls: 'json', labelKey: 'ed.t.json' },
};

function typeBadge(type: ProfileType, t: (key: MessageKey) => string): { cls: string; label: string } {
  const info = TYPE_INFO[type];
  if (info === undefined) return { cls: 'unknown', label: '?' };
  return { cls: info.cls, label: info.labelKey === undefined ? (info.label ?? '?') : t(info.labelKey) };
}

const PROTO_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'all', label: '' },
  { value: String(ProfileType.SHADOWSOCKS), label: 'Shadowsocks' },
  { value: String(ProfileType.VMESS), label: 'VMess' },
  { value: String(ProfileType.VLESS), label: 'VLESS' },
  { value: String(ProfileType.TROJAN), label: 'Trojan' },
  { value: String(ProfileType.HYSTERIA2), label: 'Hysteria2' },
  { value: String(ProfileType.TUIC), label: 'TUIC' },
  { value: String(ProfileType.SOCKS), label: 'SOCKS5' },
  { value: String(ProfileType.HTTP), label: 'HTTPS' },
];

type StatusFilter = 'all' | 'fav' | 'fast' | 'down';
type SortKey = 'delay' | 'name';

const STATUS_CHIPS: readonly { key: StatusFilter; labelKey: MessageKey }[] = [
  { key: 'all', labelKey: 'filter.all' },
  { key: 'fav', labelKey: 'filter.fav' },
  { key: 'fast', labelKey: 'filter.fast' },
  { key: 'down', labelKey: 'filter.down' },
];

export function ServersScreen(): JSX.Element {
  const { t, tf, plural, lang } = useI18n();
  const kbd = useKbdLabel();
  const core = useCore();
  const status = useCoreStatus();
  const [search, setSearch] = useState('');
  const { profiles: allProfiles, total: allTotal, refresh } = useProfiles(search);
  const [groups, setGroups] = useState<{ id: bigint; name: string; kind: Group_Kind }[]>([]);
  const [targetGroup, setTargetGroup] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [protoFilter, setProtoFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('delay');
  // Направление сортировки (прототип .sortdir): по задержке — по возрастанию,
  // повторный клик переворачивает.
  const [sortAsc, setSortAsc] = useState(true);
  // Меню режима теста (.split-btn ▾).
  const [testMenu, setTestMenu] = useState<MenuAnchor | null>(null);
  // Меню строки профиля (прототип profileMenu): копировать ссылку, тест, удалить.
  const [rowMenu, setRowMenu] = useState<(MenuAnchor & { profile: Profile }) | null>(null);
  // Меню «Переместить в группу…» полосы выделения (прототип #selMove): общий ContextMenu (T-39).
  const [moveMenu, setMoveMenu] = useState<MenuAnchor | null>(null);
  const [compact, setCompact] = useState(false);
  const [groupBySub, setGroupBySub] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [latency, setLatency] = useState<Record<string, string>>({});
  // Строки отчёта полного теста по кадрам стрима (пустая строка — отчёта нет и
  // сохранённый в профиле показывать не надо); до конца прогона список профилей
  // не обновляется.
  const [reports, setReports] = useState<Record<string, string>>({});
  // Диалог опций полного теста.
  const [fullOpen, setFullOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [progress, setProgress] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  // Подтверждение удаления: { ids, count }. null — диалог закрыт.
  const [confirmDelete, setConfirmDelete] = useState<{
    ids: readonly bigint[];
    count: number;
  } | null>(null);
  const [editing, setEditing] = useState<Profile | null | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const testAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const res = await core.profiles.listGroups({});
        const list = res.groups.map((g) => ({ id: g.id, name: g.name, kind: g.kind }));
        setGroups(list);
        setTargetGroup((cur) => {
          if (cur !== '') return cur;
          const first = list[0];
          return first === undefined ? cur : String(first.id);
        });
      } catch {
        /* ядро недоступно */
      }
    })();
  }, [core, t]);

  // Подписочные группы; все остальные серверы считаются добавленными вручную.
  const subscriptionIds = useMemo(
    () => new Set(groups.filter((g) => g.kind === Group_Kind.SUBSCRIPTION).map((g) => String(g.id))),
    [groups],
  );

  const profiles = useMemo(() => {
    let list = allProfiles;
    if (groupFilter === MANUAL_FILTER) {
      list = list.filter((p) => !subscriptionIds.has(String(p.groupId)));
    } else if (groupFilter !== 'all') {
      list = list.filter((p) => String(p.groupId) === groupFilter);
    }
    if (protoFilter !== 'all') list = list.filter((p) => String(p.type) === protoFilter);
    if (statusFilter === 'fav') list = list.filter((p) => p.favorite);
    if (statusFilter === 'fast') {
      // SS-02: отрицательная задержка = «недоступен»; в «быстрые» не входит.
      list = list.filter((p) => {
        const ms = p.testResult?.latencyMs;
        return ms !== undefined && ms > 0 && ms < 500;
      });
    }
    if (statusFilter === 'down') {
      list = list.filter((p) => isTestDown(p.testResult));
    }
    const sorted = [...list];
    const dir = sortAsc ? 1 : -1;
    if (sortKey === 'delay') {
      // Недоступные (<0) и непроверенные — в конец независимо от
      // направления: «худшие» не должны всплывать наверх при перевороте.
      const rank = (p: Profile): number => {
        const ms = p.testResult?.latencyMs;
        return ms !== undefined && ms > 0 ? ms : 1_000_000;
      };
      sorted.sort((a, b) => dir * (rank(a) - rank(b)) || a.name.localeCompare(b.name, lang));
    } else {
      sorted.sort((a, b) => dir * a.name.localeCompare(b.name, lang));
    }
    return sorted;
  }, [allProfiles, groupFilter, subscriptionIds, protoFilter, statusFilter, sortKey, sortAsc, lang]);

  // Группа нового сервера (кнопка «Добавить»). null — подходящей группы нет
  // или список групп не загружен: кнопка неактивна (см. lib/groups.ts).
  const newGroupId = useMemo(
    () => newServerGroupId(groupFilter, targetGroup, groups),
    [groupFilter, targetGroup, groups],
  );
  // Редактор: при правке — группа профиля, при создании — группа нового сервера.
  const editorGroupId = editing === null ? newGroupId : (editing?.groupId ?? null);

  // Активный сервер для бейджа «Активен» (прототип: точка зелёная при
  // подключении, жёлтая при установке соединения).
  const live =
    status.state === CoreState.CONNECTED ||
    status.state === CoreState.CONNECTING ||
    status.state === CoreState.RECONNECTING;
  const activeId = live ? (status.activeProfileId ?? 0n) : 0n;
  const activeDot = status.state === CoreState.CONNECTED ? 'ok' : 'warn';

  // Группа для импорта (см. lib/groups.ts): undefined — ядро кладёт серверы
  // в «Default» (T-07); при «Добавлены вручную» — не подписочная группа.
  const importTarget = importGroupId(groupFilter, targetGroup, groups);

  const toggleSelect = useCallback((id: bigint, on: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = String(id);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });
  }, []);

  const testLatency = useCallback(
    async (ids: bigint[], run: TestRun = { kind: 'tcp' }): Promise<void> => {
      setErr('');
      setMsg('');
      if (ids.length === 0) return;
      setTesting(true);
      setLatency({});
      setReports({});
      // SS-03: стрим отменяем при уходе с экрана/остановке, иначе setState
      // после unmount и параллельные прогоны.
      testAbort.current?.abort();
      const ac = new AbortController();
      testAbort.current = ac;
      try {
        const stream = core.profiles.testLatency(testRequest(ids, run), { signal: ac.signal });
        for await (const res of stream) {
          const r = res.result;
          const key = String(res.profileId);
          setLatency((m) => ({ ...m, [key]: resultLabel(r, t, lang) }));
          setReports((m) => ({ ...m, [key]: formatFullReport(r?.fullReport, t, lang) }));
          setProgress(tf('test.progress', { done: res.index, total: res.total }));
        }
        refresh();
      } catch (e) {
        if (!ac.signal.aborted) setErr(showCoreError(e, t));
      } finally {
        if (testAbort.current === ac) testAbort.current = null;
        setTesting(false);
        setProgress('');
      }
    },
    [core, refresh, tf, t, lang],
  );

  // SS-05: остановка рвёт стрим (контракт: отмена — закрытие стрима) и
  // снимает флаг running; ошибка больше не глотается.
  const stopTests = useCallback(async (): Promise<void> => {
    testAbort.current?.abort();
    testAbort.current = null;
    setTesting(false);
    setProgress('');
    try {
      await core.profiles.stopTests({});
    } catch (e) {
      setErr(showCoreError(e, t));
    }
  }, [core, t]);

  // Отмена стрима при размонтировании экрана.
  useEffect(() => {
    return (): void => {
      testAbort.current?.abort();
    };
  }, [t]);

  const removeSelected = useCallback(
    async (ids: readonly bigint[]): Promise<void> => {
      if (ids.length === 0) return;
      setErr('');
      try {
        await core.profiles.deleteProfile({ ids: [...ids] });
        setSelected(new Set());
        refresh();
      } catch (e) {
        setErr(showCoreError(e, t));
      }
    },
    [core, refresh, t],
  );

  /** MoveProfiles: выделенные серверы → выбранная группа (прототип #selMove). */
  const moveSelected = useCallback(
    async (targetGroupId: bigint): Promise<void> => {
      const ids = [...selected].map((s) => BigInt(s));
      if (ids.length === 0) return;
      setErr('');
      try {
        await core.profiles.moveProfiles({ ids, targetGroupId });
        setSelected(new Set());
        refresh();
      } catch (e) {
        setErr(showCoreError(e, t));
      }
    },
    [core, selected, refresh, t],
  );

  // Меню «Переместить» закрывается, когда выделение снято (клик снаружи — в ContextMenu).
  useEffect(() => {
    if (selected.size === 0) setMoveMenu(null);
  }, [selected]);

  const toggleFav = useCallback(
    async (p: Profile): Promise<void> => {
      try {
        // SS-01: SetProfileMeta замещает repeated-поля — передаём текущие
        // tags/notes, иначе они стираются при клике на «избранное».
        await core.profiles.setProfileMeta({
          id: p.id,
          favorite: !p.favorite,
          tags: p.tags,
          notes: p.notes,
        });
        refresh();
      } catch (e) {
        setErr(showCoreError(e, t));
      }
    },
    [core, refresh, t],
  );

  /** Копирует ссылки профилей в буфер; у цепочек и custom ссылки нет (T-25). */
  const copyLinks = useCallback(
    async (ids: readonly bigint[]): Promise<void> => {
      setErr('');
      setMsg('');
      try {
        const res = await core.profiles.exportLinks({ ids: [...ids] });
        if (res.links.length === 0) {
          setErr(t('srv.noLink'));
          return;
        }
        await navigator.clipboard.writeText(res.links.join('\n'));
        setMsg(t('toast.copied'));
      } catch (e) {
        setErr(showCoreError(e, t));
      }
    },
    [core, t],
  );

  /** «Копировать ссылку» в панели: выделенные серверы, без выделения — видимые. */
  const exportLinks = useCallback(async (): Promise<void> => {
    const ids = selected.size > 0 ? [...selected].map((s) => BigInt(s)) : profiles.map((p) => p.id);
    if (ids.length > 0) await copyLinks(ids);
  }, [selected, profiles, copyLinks]);

  /** Копировать ссылку одного профиля (пункт меню строки) — вне зависимости от выделения. */
  const copyOneLink = useCallback((id: bigint): Promise<void> => copyLinks([id]), [copyLinks]);

  const rowProps = useCallback(
    (p: Profile): RowProps => ({
      p,
      compact,
      checked: selected.has(String(p.id)),
      latencyLabel: latency[String(p.id)],
      reportLabel: reports[String(p.id)],
      onCheck: (on: boolean): void => {
        toggleSelect(p.id, on);
      },
      onEdit: (): void => {
        setEditing(p);
      },
      onFav: (): void => {
        void toggleFav(p);
      },
      onDelete: (): void => {
        // Удаление сервера необратимо — прототип всегда спрашивает.
        setConfirmDelete({ ids: [p.id], count: 1 });
      },
      menuOpen: rowMenu?.profile.id === p.id,
      // Повторный клик по «≡» закрывает меню своей строки.
      onRowMenu: (anchor: MenuAnchor): void => {
        setRowMenu((cur) => (cur?.profile.id === p.id ? null : { ...anchor, profile: p }));
      },
      badge: typeBadge(p.type, t),
      active: activeId !== 0n && p.id === activeId,
      activeDot,
    }),
    [compact, selected, latency, reports, rowMenu, toggleSelect, toggleFav, t, activeId, activeDot],
  );

  return (
    <div className="srv">
      {groups.length > 0 && (
        <div className="srv-gtabs" role="tablist" aria-label={t('grp.title')}>
          <button
            className={`srv-gtab${groupFilter === 'all' ? ' on' : ''}`}
            role="tab"
            aria-selected={groupFilter === 'all'}
            onClick={() => {
              setGroupFilter('all');
            }}
          >
            {t('srv.all')}
            <span className="muted">{String(allTotal)}</span>
          </button>
          {groups.map((g) => (
            <button
              key={String(g.id)}
              className={`srv-gtab${groupFilter === String(g.id) ? ' on' : ''}`}
              role="tab"
              aria-selected={groupFilter === String(g.id)}
              title={groupDisplayName(g, t)}
              onClick={() => {
                setGroupFilter(String(g.id));
              }}
            >
              <span className="srv-gtab-name">{groupDisplayName(g, t)}</span>
            </button>
          ))}
          <button
            className="srv-gtab srv-gtab-add"
            aria-label={t('grp.create')}
            title={t('grp.create')}
            onClick={() => {
              setGroupsOpen(true);
            }}
          >
            <Icon name="plus" />
          </button>
        </div>
      )}

      <div className="prof-toolbar">
        <div className="searchwrap">
          <span className="ic">
            <Icon name="search" />
          </span>
          <input
            className="input"
            id="profSearch"
            type="text"
            placeholder={t('prof.searchPh')}
            aria-label={t('prof.searchPh')}
            autoComplete="off"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
          <span className="kbd">{kbd('K')}</span>
        </div>

        <div className="chips">
          {STATUS_CHIPS.map((c) => (
            <button
              key={c.key}
              className={`chip${statusFilter === c.key ? ' on' : ''}`}
              onClick={() => {
                setStatusFilter(c.key);
              }}
            >
              {t(c.labelKey)}
            </button>
          ))}
        </div>

        <div className="prof-filter">
          <label className="cap" htmlFor="protoSel">
            {t('filter.proto')}
          </label>
          <select
            className="select"
            id="protoSel"
            value={protoFilter}
            onChange={(e) => {
              setProtoFilter(e.target.value);
            }}
          >
            {PROTO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === 'all' ? t('filter.protoAny') : o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Фильтр по подписке (прототип #subSel): серверов может быть
            несколько сотен из разных подписок. */}
        <div className="prof-filter">
          <label className="cap" htmlFor="subSel">
            {t('filter.sub')}
          </label>
          <select
            className="select"
            id="subSel"
            value={groupFilter}
            onChange={(e) => {
              setGroupFilter(e.target.value);
            }}
          >
            <option value="all">{t('filter.subAny')}</option>
            <option value={MANUAL_FILTER}>{t('srv.manual')}</option>
            {groups.map((g) => (
              <option key={String(g.id)} value={String(g.id)}>
                {groupDisplayName(g, t)}
              </option>
            ))}
          </select>
        </div>

        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setGroupsOpen(true);
          }}
        >
          <Icon name="layers" />
          <span>{t('grp.manage')}</span>
        </button>
      </div>

      <div className="prof-toolbar">
        <div className="seg mini">
          <button className={compact ? '' : ' on'} onClick={() => { setCompact(false); }}>
            {t('dens.normal')}
          </button>
          <button className={compact ? 'on' : ''} onClick={() => { setCompact(true); }}>
            {t('dens.compact')}
          </button>
        </div>
        <span className="sub-auto">
          <span>{t('srv.group')}</span>
          <button
            className={`sw${groupBySub ? ' on' : ''}`}
            role="switch"
            aria-checked={groupBySub}
            aria-label={t('srv.group')}
            onClick={() => {
              setGroupBySub((v) => !v);
            }}
          />
        </span>
        <span className="flex1" />
        {progress !== '' && <span className="cap mono">{progress}</span>}
        {/* split-btn прототипа: «Проверить все» + меню режима теста
            (задержка / полный тест с UDP и скоростью). */}
        <div className="split-btn">
          <button
            className="btn btn-sec"
            disabled={testing || profiles.length === 0}
            onClick={() => {
              void testLatency(profiles.map((p) => p.id));
            }}
          >
            <Icon name="gauge" />
            <span>{t('test.all')}</span>
          </button>
          <button
            className="btn btn-sec btn-ic"
            aria-haspopup="menu"
            aria-expanded={testMenu !== null}
            aria-label={t('test.more')}
            title={t('test.more')}
            disabled={testing || profiles.length === 0}
            onClick={(e) => {
              if (testMenu !== null) {
                setTestMenu(null);
                return;
              }
              const r = e.currentTarget.getBoundingClientRect();
              setTestMenu({ at: { x: r.left - 140, y: r.bottom + 4 }, trigger: e.currentTarget });
            }}
          >
            <Icon name="chevron-down" size={16} />
          </button>
        </div>
        {testing && (
          <button className="btn btn-ghost btn-sm" onClick={() => void stopTests()}>
            {t('test.stop')}
          </button>
        )}
        <button
          className="btn btn-ghost btn-sm"
          title={t('prof.sortTip')}
          onClick={() => {
            // Повторный клик по тому же режиму переворачивает направление;
            // смена режима сбрасывает на возрастание.
            if (sortKey === 'delay') {
              setSortAsc((v) => !v);
            } else {
              setSortKey('delay');
              setSortAsc(true);
            }
          }}
        >
          <Icon name="sliders" />
          <span>{sortKey === 'delay' ? t('prof.sortDelay') : t('prof.sortName')}</span>
          <span className={`sortdir${sortAsc ? '' : ' desc'}`}>
            <Icon name="chevron-down" size={16} />
          </span>
        </button>
        <span className="cap mono">
          {plural('pl.p', profiles.length)}
        </span>
      </div>

      <div className="srv-actions">
        <button
          className="btn btn-sec"
          onClick={() => {
            setImportOpen(true);
          }}
        >
          <Icon name="download" />
          <span>{t('prof.import')}</span>
        </button>
        <button
          className="btn btn-pri"
          disabled={newGroupId === null}
          onClick={() => {
            setEditing(null);
          }}
        >
          <Icon name="plus" />
          <span>{t('prof.add')}</span>
        </button>
        <span className="flex1" />
        <button
          className="btn btn-ghost btn-sm"
          disabled={selected.size === 0 && profiles.length === 0}
          onClick={() => void exportLinks()}
        >
          <Icon name="copy" />
          <span>{t('common.copyLink')}</span>
        </button>
      </div>

      {/* Полоса выделения (прототип #selBar): проверить, переместить в группу,
          удалить, снять выделение. */}
      {selected.size > 0 && (
        <div className="selbar" role="toolbar" aria-label={tf('srv.selected', { n: selected.size })}>
          <span className="cap">{tf('srv.selected', { n: selected.size })}</span>
          <button
            className="btn btn-sec btn-sm"
            disabled={testing}
            onClick={() => {
              void testLatency([...selected].map((s) => BigInt(s)));
            }}
          >
            {t('test.latency')}
          </button>
          <button
            className="btn btn-sec btn-sm"
            id="selMove"
            aria-haspopup="menu"
            aria-expanded={moveMenu !== null}
            onClick={(e) => {
              if (moveMenu !== null) {
                setMoveMenu(null);
                return;
              }
              const r = e.currentTarget.getBoundingClientRect();
              setMoveMenu({ at: { x: r.left, y: r.bottom + 4 }, trigger: e.currentTarget });
            }}
          >
            {t('srv.move')}
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => {
              setConfirmDelete({
                ids: [...selected].map((s) => BigInt(s)),
                count: selected.size,
              });
            }}
          >
            {t('srv.delSel')}
          </button>
          <span className="flex1" />
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSelected(new Set());
            }}
          >
            {t('srv.selClear')}
          </button>
        </div>
      )}

      {msg !== '' && <div className="toast-ok" role="status">{msg}</div>}
      {err !== '' && (
        <div className="banner banner-err" role="alert">
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="bn-t">{err}</div>
        </div>
      )}

      {profiles.length === 0 ? (
        <div className="empty">
          <Icon name="layers" />
          <div className="empty-t">{t('srv.empty.t')}</div>
          <div className="empty-d">{t('srv.empty.d')}</div>
          <button
            className="btn btn-pri"
            onClick={() => {
              setImportOpen(true);
            }}
          >
            {t('prof.import')}
          </button>
        </div>
      ) : groupBySub ? (
        <div className="srv-groups">
          {groupByGeo(profiles, (p) => p.geo, lang).map((g) => (
            <section key={g.code === '' ? '_' : g.code} className="srv-group">
              <h3 className="srv-group-h">
                <span className="srv-flag" aria-hidden="true">{g.flag}</span>
                {g.label}
                <span className="muted">{g.items.length}</span>
              </h3>
              <ul className={`prof-list${compact ? ' compact' : ''}`}>
                {g.items.map((p) => (
                  <ProfileRow key={String(p.id)} {...rowProps(p)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className={`prof-list${compact ? ' compact' : ''}`}>
          {profiles.map((p) => (
            <ProfileRow key={String(p.id)} {...rowProps(p)} />
          ))}
        </ul>
      )}

      {groupsOpen && (
        <GroupsDialog
          onClose={() => {
            setGroupsOpen(false);
          }}
          onChanged={refresh}
        />
      )}

      {importOpen && (
        <ImportDialog
          groupId={importTarget}
          onClose={() => {
            setImportOpen(false);
          }}
          onImported={refresh}
        />
      )}

      {editing !== undefined && editorGroupId !== null && (
        <ProfileEditor
          profile={editing}
          groupId={editorGroupId}
          onClose={() => {
            setEditing(undefined);
          }}
          onSaved={refresh}
        />
      )}
      {/* Меню режима теста (прототип #testMore): задержка (TCP), URL-тест и
          полный тест — последний сначала спрашивает, что проверять. */}
      {testMenu !== null && (
        <ContextMenu
          anchor={testMenu}
          onClose={() => {
            setTestMenu(null);
          }}
        >
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setTestMenu(null);
              void testLatency(profiles.map((p) => p.id));
            }}
          >
            <Icon name="gauge" size={16} />
            <span>{t('test.latency')}</span>
          </button>
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setTestMenu(null);
              void testLatency(
                profiles.map((p) => p.id),
                { kind: 'url' },
              );
            }}
          >
            <Icon name="globe" size={16} />
            <span>{t('test.url')}</span>
          </button>
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setTestMenu(null);
              setFullOpen(true);
            }}
          >
            <Icon name="activity" size={16} />
            <span>{t('test.full')}</span>
          </button>
        </ContextMenu>
      )}

      {/* Опции полного теста; запуск — по всем видимым серверам, как «Проверить все». */}
      {fullOpen && (
        <FullTestDialog
          onClose={() => {
            setFullOpen(false);
          }}
          onStart={(options) => {
            setFullOpen(false);
            void testLatency(
              profiles.map((p) => p.id),
              { kind: 'full', options },
            );
          }}
        />
      )}

      {/* Меню «Переместить в группу…» (прототип #selMove). Подписочные группы
          исключены: ручной сервер внутри подписки сотрёт следующее обновление. */}
      {moveMenu !== null && (
        <ContextMenu
          anchor={moveMenu}
          onClose={() => {
            setMoveMenu(null);
          }}
        >
          {groups
            .filter((g) => g.kind !== Group_Kind.SUBSCRIPTION)
            .map((g) => (
              <button
                key={String(g.id)}
                className="menu-item"
                role="menuitem"
                onClick={() => {
                  setMoveMenu(null);
                  void moveSelected(g.id);
                }}
              >
                <Icon name="layers" size={16} />
                <span>{groupDisplayName(g, t)}</span>
              </button>
            ))}
        </ContextMenu>
      )}

      {/* Меню строки профиля (прототип profileMenu). */}
      {rowMenu !== null && (
        <ContextMenu
          anchor={rowMenu}
          onClose={() => {
            setRowMenu(null);
          }}
        >
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              const id = rowMenu.profile.id;
              setRowMenu(null);
              void copyOneLink(id);
            }}
          >
            <Icon name="copy" size={16} />
            <span>{t('common.copyLink')}</span>
          </button>
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              const id = rowMenu.profile.id;
              setRowMenu(null);
              void testLatency([id]);
            }}
          >
            <Icon name="gauge" size={16} />
            <span>{t('common.testLatency')}</span>
          </button>
          <div className="menu-sep" role="separator" />
          <button
            className="menu-item danger"
            role="menuitem"
            onClick={() => {
              const id = rowMenu.profile.id;
              setRowMenu(null);
              setConfirmDelete({ ids: [id], count: 1 });
            }}
          >
            <Icon name="trash" size={16} />
            <span>{t('common.delete')}</span>
          </button>
        </ContextMenu>
      )}

      {confirmDelete !== null && (
        <ConfirmDialog
          title={t('common.delete')}
          text={tf('srv.delConfirm', { n: confirmDelete.count })}
          confirmLabel={t('common.delete')}
          danger
          onConfirm={() => {
            const ids = confirmDelete.ids;
            setConfirmDelete(null);
            void removeSelected(ids);
          }}
          onClose={() => {
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

interface RowProps {
  readonly p: Profile;
  readonly compact: boolean;
  readonly checked: boolean;
  readonly latencyLabel: string | undefined;
  /** Строка отчёта полного теста из текущего прогона; undefined — брать из профиля. */
  readonly reportLabel: string | undefined;
  readonly onCheck: (on: boolean) => void;
  readonly onEdit: () => void;
  readonly onFav: () => void;
  readonly onDelete: () => void;
  /** Меню строки открыто: aria-expanded у кнопки «≡». */
  readonly menuOpen: boolean;
  /** Меню строки (копировать ссылку / тест / удалить): прототип profileMenu. */
  readonly onRowMenu: (anchor: MenuAnchor) => void;
  /** Бейдж типа: подпись и суффикс класса (.badge.bt-<cls>). */
  readonly badge: { readonly cls: string; readonly label: string };
  /** Сервер подключён/подключается прямо сейчас — бейдж «Активен». */
  readonly active: boolean;
  readonly activeDot: 'ok' | 'warn';
}

function ProfileRow({
  p,
  compact,
  checked,
  latencyLabel,
  reportLabel,
  onCheck,
  onEdit,
  onFav,
  onDelete,
  menuOpen,
  onRowMenu,
  badge,
  active,
  activeDot,
}: RowProps): JSX.Element {
  const { t, tf, lang } = useI18n();
  const moreRef = useRef<HTMLButtonElement | null>(null);
  // Меню строки привязано к кнопке «≡» (прототип: row.querySelector('[data-menu-p]').click()).
  const openMenu = (): void => {
    const btn = moreRef.current;
    if (btn === null) return;
    const r = btn.getBoundingClientRect();
    onRowMenu({ at: { x: r.left - 160, y: r.bottom + 4 }, trigger: btn });
  };
  const ms = p.testResult?.latencyMs;
  const na = isTestNotApplicable(p.testResult);
  const delay =
    latencyLabel ?? (na ? t('test.na') : ms !== undefined && ms > 0 ? formatMs(ms, lang) : '—');
  const down = isTestDown(p.testResult);
  const report = reportLabel ?? formatFullReport(p.testResult?.fullReport, t, lang);
  return (
    <li
      className={`prow${checked ? ' sel' : ''}${active ? ' active' : ''}`}
      onKeyDown={(e) => {
        // Shift+F10 и клавиша ContextMenu открывают меню строки.
        if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
          e.preventDefault();
          openMenu();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu();
      }}
    >
      <input
        type="checkbox"
        className="prow-chk"
        checked={checked}
        aria-label={tf('srv.select', { name: p.name })}
        onChange={(e) => {
          onCheck(e.target.checked);
        }}
      />
      <button
        className={`prow-fav${p.favorite ? ' on' : ''}`}
        aria-label={p.favorite ? t('prof.favRm') : t('prof.favAdd')}
        title={p.favorite ? t('prof.favRm') : t('prof.favAdd')}
        onClick={onFav}
      >
        <Icon name="star" />
      </button>
      <button className="prow-main" onClick={onEdit} title={p.name}>
        <span className="prow-title">
          <span className="prow-name">{p.name}</span>
          <span className={`badge bt-${badge.cls}`}>{badge.label}</span>
          {!compact &&
            p.tags.map((tag) => (
              <span className="p-tag" key={tag}>
                {tag}
              </span>
            ))}
          {active && (
            <span className="badge badge-ok">
              <span className={`dot ${activeDot}`} />
              {t('srv.active')}
            </span>
          )}
        </span>
        {!compact && p.address !== '' && (
          <span className="prow-addr mono">
            {p.address}:{String(p.port)}
          </span>
        )}
      </button>
      <span className="prow-res">
        <span className={`prow-lat mono${down ? ' err' : delay === '—' ? ' na' : ''}`}>{delay}</span>
        {report !== '' && (
          <span className="prow-rep mono" title={report}>
            {report}
          </span>
        )}
      </span>
      <button
        className="prow-more btn btn-ic btn-sm"
        aria-label={t('aria.menu')}
        title={t('aria.menu')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        ref={moreRef}
        onClick={openMenu}
      >
        <Icon name="dots" size={16} />
      </button>
      <button
        className="prow-del btn btn-ic btn-sm"
        aria-label={t('common.delete')}
        title={t('common.delete')}
        onClick={onDelete}
      >
        <Icon name="trash" />
      </button>
    </li>
  );
}
