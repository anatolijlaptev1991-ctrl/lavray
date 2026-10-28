// screen_servers.tsx — «Серверы» по прототипу v1.2 (DS §8, FR-UI-081…099):
// вкладки групп, тулбар с поиском/фильтрами/протоколом, второй тулбар с
// плотностью/группировкой/тестом, список профилей карточками, массовое
// выделение, тест задержки с прогрессом, гео-группировка.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { ProfileType, TestLatencyRequest_Mode } from '../gen/lavray_pb';
import type { Profile } from '../gen/lavray_pb';
import { useCore, useProfiles } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { showCoreError } from '../lib/core';
import { groupByGeo } from '../lib/geo';
import { formatMs } from '../lib/i18n';
import { ProfileEditor } from '../components/ProfileEditor';
import { ImportDialog } from '../components/ImportDialog';
import { ConfirmDialog, GroupsDialog } from '../components/dialogs';
import { Icon } from '../components/Icon';

const TYPE_LABEL: Record<number, string> = {
  [ProfileType.SOCKS]: 'SOCKS',
  [ProfileType.HTTP]: 'HTTP',
  [ProfileType.SHADOWSOCKS]: 'SS',
  [ProfileType.TROJAN]: 'Trojan',
  [ProfileType.VMESS]: 'VMess',
  [ProfileType.VLESS]: 'VLESS',
  [ProfileType.HYSTERIA2]: 'Hy2',
  [ProfileType.TUIC]: 'TUIC',
  [ProfileType.CHAIN]: 'Chain',
  [ProfileType.CUSTOM_OUTBOUND]: 'Custom',
  [ProfileType.CUSTOM_CONFIG]: 'Config',
};

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

const STATUS_CHIPS: readonly { key: StatusFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'filter.all' },
  { key: 'fav', labelKey: 'filter.fav' },
  { key: 'fast', labelKey: 'filter.fast' },
  { key: 'down', labelKey: 'filter.down' },
];

export function ServersScreen(): JSX.Element {
  const { t, tf, lang } = useI18n();
  const core = useCore();
  const [search, setSearch] = useState('');
  const { profiles: allProfiles, total: allTotal, refresh } = useProfiles(search);
  const [groups, setGroups] = useState<{ id: bigint; name: string }[]>([]);
  const [targetGroup, setTargetGroup] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [protoFilter, setProtoFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('delay');
  const [compact, setCompact] = useState(false);
  const [groupBySub, setGroupBySub] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [latency, setLatency] = useState<Record<string, string>>({});
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
        const list = res.groups.map((g) => ({ id: g.id, name: g.name }));
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

  const profiles = useMemo(() => {
    let list = allProfiles;
    if (groupFilter !== 'all') list = list.filter((p) => String(p.groupId) === groupFilter);
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
      list = list.filter((p) => (p.testResult?.lastError ?? '') !== '');
    }
    const sorted = [...list];
    if (sortKey === 'delay') {
      // Недоступные (<0) и непроверенные — в конец, между собой по имени.
      const rank = (p: Profile): number => {
        const ms = p.testResult?.latencyMs;
        return ms !== undefined && ms > 0 ? ms : 1_000_000;
      };
      sorted.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, lang));
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name, lang));
    }
    return sorted;
  }, [allProfiles, groupFilter, protoFilter, statusFilter, sortKey, lang]);

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
    async (ids: bigint[]): Promise<void> => {
      setErr('');
      setMsg('');
      if (ids.length === 0) return;
      setTesting(true);
      setLatency({});
      // SS-03: стрим отменяем при уходе с экрана/остановке, иначе setState
      // после unmount и параллельные прогоны.
      testAbort.current?.abort();
      const ac = new AbortController();
      testAbort.current = ac;
      try {
        const stream = core.profiles.testLatency(
          { profileIds: ids, mode: TestLatencyRequest_Mode.TCP_PING },
          { signal: ac.signal },
        );
        for await (const res of stream) {
          const r = res.result;
          const key = String(res.profileId);
          const down = (r?.lastError ?? '') !== '';
          setLatency((m) => ({
            ...m,
            [key]: down ? '✕' : `${String(r?.latencyMs ?? 0)} ms`,
          }));
          setProgress(tf('test.progress', { i: res.index, n: res.total }));
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
    [core, refresh, tf, t],
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

  const exportLinks = useCallback(async (): Promise<void> => {
    setErr('');
    try {
      const res =
        selected.size > 0
          ? await core.profiles.exportLinks({ ids: [...selected].map((s) => BigInt(s)) })
          : await core.profiles.exportLinks(
              groupFilter === 'all' ? {} : { groupId: BigInt(groupFilter) },
            );
      await navigator.clipboard.writeText(res.links.join('\n'));
      setMsg(t('toast.copied'));
    } catch (e) {
      setErr(showCoreError(e, t));
    }
  }, [core, selected, groupFilter, t]);

  const rowProps = useCallback(
    (p: Profile): RowProps => ({
      p,
      compact,
      checked: selected.has(String(p.id)),
      latencyLabel: latency[String(p.id)],
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
      typeLabel: TYPE_LABEL[p.type] ?? '?',
    }),
    [compact, selected, latency, toggleSelect, toggleFav],
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
              onClick={() => {
                setGroupFilter(String(g.id));
              }}
            >
              {g.name}
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
            type="text"
            placeholder={t('prof.searchPh')}
            aria-label={t('prof.searchPh')}
            autoComplete="off"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
          <span className="kbd">Ctrl K</span>
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
              {t(c.labelKey as never)}
            </button>
          ))}
        </div>

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
        {testing && (
          <button className="btn btn-ghost btn-sm" onClick={() => void stopTests()}>
            {t('test.stop')}
          </button>
        )}
        <button
          className="btn btn-ghost btn-sm"
          title={t('prof.sortTip')}
          onClick={() => {
            setSortKey((k) => (k === 'delay' ? 'name' : 'delay'));
          }}
        >
          <Icon name="sliders" />
          <span>{sortKey === 'delay' ? t('prof.sortDelay') : t('prof.sortName')}</span>
        </button>
        <span className="cap mono">
          {t('srv.current')}: {String(profiles.length)}
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
          disabled={targetGroup === '' && groupFilter === 'all'}
          onClick={() => {
            setEditing(null);
          }}
        >
          <Icon name="plus" />
          <span>{t('prof.add')}</span>
        </button>
        <span className="flex1" />
        <button className="btn btn-ghost btn-sm" onClick={() => void exportLinks()}>
          <Icon name="copy" />
          <span>{t('common.copyLink')}</span>
        </button>
        {selected.size > 0 && (
          <>
            <span className="cap mono">{tf('srv.selected', { n: selected.size })}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setSelected(new Set());
              }}
            >
              {t('srv.selClear')}
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
              <Icon name="trash" />
              <span>{t('srv.delSel')}</span>
            </button>
          </>
        )}
      </div>

      {msg !== '' && <div className="toast-ok">{msg}</div>}
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
          groupId={BigInt(
            groupFilter !== 'all' ? groupFilter : targetGroup === '' ? '0' : targetGroup,
          )}
          onClose={() => {
            setImportOpen(false);
          }}
          onImported={refresh}
        />
      )}

      {editing !== undefined && (
        <ProfileEditor
          profile={editing}
          groupId={BigInt(
            groupFilter !== 'all' ? groupFilter : targetGroup === '' ? '0' : targetGroup,
          )}
          onClose={() => {
            setEditing(undefined);
          }}
          onSaved={refresh}
        />
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
  readonly onCheck: (on: boolean) => void;
  readonly onEdit: () => void;
  readonly onFav: () => void;
  readonly onDelete: () => void;
  readonly typeLabel: string;
}

function ProfileRow({
  p,
  compact,
  checked,
  latencyLabel,
  onCheck,
  onEdit,
  onFav,
  onDelete,
  typeLabel,
}: RowProps): JSX.Element {
  const { t, tf, lang } = useI18n();
  const ms = p.testResult?.latencyMs;
  const delay =
    latencyLabel ?? (ms !== undefined && ms > 0 ? formatMs(ms, lang) : '—');
  const down = (p.testResult?.lastError ?? '') !== '';
  return (
    <li className={`prow${checked ? ' sel' : ''}`}>
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
        <Icon name="check" />
      </button>
      <button className="prow-main" onClick={onEdit} title={t('common.edit')}>
        <span className="prow-name">{p.name}</span>
        {!compact && (
          <span className="prow-addr mono">
            {p.address}:{String(p.port)}
          </span>
        )}
      </button>
      {!compact && <span className="prow-type mono">{typeLabel}</span>}
      <span className={`prow-lat mono${down ? ' err' : ''}`}>{delay}</span>
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
