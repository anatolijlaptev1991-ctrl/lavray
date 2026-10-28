// screen_servers.tsx — «Серверы» (DS §8, FR-UI-081…099/257): список,
// поиск, выбор, импорт контента (ссылка/список/QR-строка) с двухфазным
// подтверждением custom-полей, экспорт ссылок.
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { ProfileType, TestLatencyRequest_Mode } from '../gen/lavray_pb';
import type { Profile } from '../gen/lavray_pb';
import { useCore, useProfiles } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { friendlyCoreError } from '../lib/core';
import { groupByGeo } from '../lib/geo';
import { ProfileEditor } from '../components/ProfileEditor';
import { ImportDialog } from '../components/ImportDialog';

const TYPE_LABEL: Record<number, string> = {
  [ProfileType.SOCKS]: 'SOCKS',
  [ProfileType.HTTP]: 'HTTP',
  [ProfileType.SHADOWSOCKS]: 'Shadowsocks',
  [ProfileType.TROJAN]: 'Trojan',
  [ProfileType.VMESS]: 'VMess',
  [ProfileType.VLESS]: 'VLESS',
  [ProfileType.HYSTERIA2]: 'Hysteria2',
  [ProfileType.TUIC]: 'TUIC',
  [ProfileType.CHAIN]: 'Chain',
};

export function ServersScreen(): JSX.Element {
  const { t, lang } = useI18n();
  const core = useCore();
  const [search, setSearch] = useState('');
  const { profiles, total, refresh } = useProfiles(search);
  const [importing, setImporting] = useState(false);
  const [link, setLink] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState<Profile[]>([]);
  const [groups, setGroups] = useState<{ id: bigint; name: string }[]>([]);
  const [targetGroup, setTargetGroup] = useState('');
  const [latency, setLatency] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState<Profile | null | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);

  // Реальные группы из ядра (A2 аудита №4: хардкод '1' → NOT_FOUND,
  // потому что встроенная группа живёт в резервном id-диапазоне).
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
        /* ядро недоступно — импорт останется выключенным до следующего рендера */
      }
    })();
  }, [core]);

  const doPreview = useCallback(async (): Promise<void> => {
    setErr('');
    setMsg('');
    try {
      const res = await core.profiles.importContent({
        content: link,
        previewOnly: true,
      });
      setPreview(res.parsedProfiles);
      setMsg(t('imp.do'));
    } catch (e) {
      setErr(friendlyCoreError(e));
    }
  }, [core, link, t]);

  const doCommit = useCallback(async (): Promise<void> => {
    setErr('');
    try {
      const res = await core.profiles.importContent({
        content: link,
        targetGroupId: targetGroup === '' ? 0n : BigInt(targetGroup),
      });
      setMsg(`${t('imp.do')}: ${String(res.addedProfileIds.length)}`);
      setPreview([]);
      setLink('');
      setImporting(false);
      refresh();
    } catch (e) {
      setErr(friendlyCoreError(e));
    }
  }, [core, link, targetGroup, t, refresh]);

  const doExport = useCallback(async (): Promise<void> => {
    setErr('');
    try {
      const res = await core.profiles.exportLinks({
        groupId: targetGroup === '' ? 0n : BigInt(targetGroup),
      });
      await navigator.clipboard.writeText(res.links.join('\n'));
      setMsg(t('toast.copied'));
    } catch (e) {
      setErr(friendlyCoreError(e));
    }
  }, [core, targetGroup, t]);

  // Тест задержки TCP-пингом (FR-UI-200): ядро стримит кадр на профиль,
  // результат тут же появляется в списке и сохраняется в профиле.
  const testLatency = useCallback(async (): Promise<void> => {
    setErr('');
    setMsg('');
    const ids = profiles.map((p) => p.id);
    if (ids.length === 0) return;
    setTesting(true);
    setLatency({});
    try {
      const stream = core.profiles.testLatency({
        profileIds: ids,
        mode: TestLatencyRequest_Mode.TCP_PING,
      });
      for await (const res of stream) {
        const r = res.result;
        const key = String(res.profileId);
        if (r?.lastError !== undefined && r.lastError !== '') {
          setLatency((m) => ({ ...m, [key]: '✕' }));
        } else if (r?.latencyMs !== undefined) {
          setLatency((m) => ({ ...m, [key]: `${String(r.latencyMs)} ms` }));
        }
        setMsg(`${String(res.index)} / ${String(res.total)}`);
      }
      refresh();
    } catch (e) {
      setErr(friendlyCoreError(e));
    } finally {
      setTesting(false);
      setMsg('');
    }
  }, [core, profiles, refresh]);

  const removeSelected = useCallback(
    async (id: bigint): Promise<void> => {
      setErr('');
      try {
        await core.profiles.deleteProfile({ ids: [id] });
        refresh();
      } catch (e) {
        setErr(friendlyCoreError(e));
      }
    },
    [core, refresh],
  );

  return (
    <div className="srv">

      <div className="srv-tools">
        <input
          className="input"
          placeholder={t('srv.all')}
          value={search}
          onChange={(e) => { setSearch(e.target.value); }}
          aria-label={t('srv.all')}
        />
        <button className="btn" onClick={() => { setImportOpen(true); }}>
          {t('imp.title')}
        </button>
        <button
          className="btn primary"
          onClick={() => { setEditing(null); }}
          disabled={targetGroup === ''}
        >
          {t('quick.import')}
        </button>
        <button className="btn" onClick={() => void doExport()}>
          {t('srv.details')}
        </button>
        <button
          className="btn"
          onClick={() => void testLatency()}
          disabled={testing || profiles.length === 0}
        >
          {testing ? t('imp.decrypting') : t('common.testLatency')}
        </button>
        <span className="muted">{t('srv.current')}: {String(total)}</span>
      </div>

      {importing && (
        <div className="srv-import">
          <textarea
            className="input"
            rows={3}
            placeholder={t('imp.drop')}
            value={link}
            onChange={(e) => { setLink(e.target.value); }}
            aria-label={t('imp.drop')}
          />
          <div className="srv-import-row">
            <select
              className="input narrow"
              value={targetGroup}
              onChange={(e) => { setTargetGroup(e.target.value); }}
              aria-label={t('srv.current')}
            >
              {groups.length === 0 && <option value="">—</option>}
              {groups.map((g) => (
                <option key={String(g.id)} value={String(g.id)}>
                  {g.name}
                </option>
              ))}
            </select>
            <button className="btn" onClick={() => void doPreview()} disabled={link.trim() === ''}>
              {t('imp.decrypting')}
            </button>
            <button
              className="btn primary"
              onClick={() => void doCommit()}
              disabled={link.trim() === '' || targetGroup === ''}
            >
              {t('imp.do')}
            </button>
          </div>
          {preview.length > 0 && (
            <ul className="srv-preview">
              {preview.map((p, i) => (
                <li key={`${String(p.type)}-${String(i)}`}>
                  {TYPE_LABEL[p.type] ?? '?'} · {p.name} · {p.address}:{String(p.port)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {msg !== '' && <div className="toast-ok">{msg}</div>}
      {err !== '' && <div className="toast-err" role="alert">{err}</div>}

      {profiles.length === 0 ? (
        <p className="muted">{t('srv.empty.d')}</p>
      ) : (
        <div className="srv-groups">
          {groupByGeo(profiles, (p) => p.geo, lang).map((g) => (
            <section key={g.code === '' ? '_' : g.code} className="srv-group">
              <h3 className="srv-group-h">
                <span className="srv-flag" aria-hidden="true">{g.flag}</span>
                {g.label}
                <span className="muted">{g.items.length}</span>
              </h3>
              <ul className="srv-list">
                {g.items.map((p) => (
                  <li key={String(p.id)} className="srv-row">
                    <span className="srv-type">{TYPE_LABEL[p.type] ?? '?'}</span>
                    <button
                      className="srv-name"
                      style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', textAlign: 'start' }}
                      onClick={() => { setEditing(p); }}
                      title={t('common.edit')}
                    >
                      {p.name}
                    </button>
                    <span className="muted mono">
                      {p.address}:{String(p.port)}
                    </span>
                    <span className="mono srv-lat">
                      {latency[String(p.id)] ??
                        (p.testResult?.latencyMs !== undefined
                          ? `${String(p.testResult.latencyMs)} ms`
                          : '—')}
                    </span>
                    <button
                      className="btn ghost"
                      onClick={() => void removeSelected(p.id)}
                      aria-label={`${t('srv.delSel')} ${p.name}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {importOpen && (
        <ImportDialog
          groupId={targetGroup === '' ? 0n : BigInt(targetGroup)}
          onClose={() => { setImportOpen(false); }}
          onImported={refresh}
        />
      )}

      {editing !== undefined && (
        <ProfileEditor
          profile={editing}
          groupId={targetGroup === '' ? 0n : BigInt(targetGroup)}
          onClose={() => { setEditing(undefined); }}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
