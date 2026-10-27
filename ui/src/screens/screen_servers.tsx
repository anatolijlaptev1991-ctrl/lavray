// screen_servers.tsx — «Серверы» (DS §8, FR-UI-081…099/257): список,
// поиск, выбор, импорт контента (ссылка/список/QR-строка) с двухфазным
// подтверждением custom-полей, экспорт ссылок.
import { useCallback, useState } from 'react';
import type { JSX } from 'react';
import { ProfileType } from '../gen/lavray_pb';
import type { Profile } from '../gen/lavray_pb';
import { useCore, useProfiles } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { friendlyCoreError } from '../lib/core';

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
  const { t } = useI18n();
  const core = useCore();
  const [search, setSearch] = useState('');
  const { profiles, total, refresh } = useProfiles(search);
  const [importing, setImporting] = useState(false);
  const [link, setLink] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState<Profile[]>([]);
  const [targetGroup, setTargetGroup] = useState('1');

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
        targetGroupId: BigInt(targetGroup),
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
      const res = await core.profiles.exportLinks({ groupId: BigInt(targetGroup) });
      await navigator.clipboard.writeText(res.links.join('\n'));
      setMsg(t('toast.copied'));
    } catch (e) {
      setErr(friendlyCoreError(e));
    }
  }, [core, targetGroup, t]);

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
        <button className="btn" onClick={() => { setImporting((v) => !v); }}>
          {t('imp.do')}
        </button>
        <button className="btn" onClick={() => void doExport()}>
          {t('srv.details')}
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
            <input
              className="input narrow"
              value={targetGroup}
              onChange={(e) => { setTargetGroup(e.target.value.replace(/\D/g, '') || '1'); }}
              aria-label={t('srv.current')}
            />
            <button className="btn" onClick={() => void doPreview()} disabled={link.trim() === ''}>
              {t('imp.decrypting')}
            </button>
            <button className="btn primary" onClick={() => void doCommit()} disabled={link.trim() === ''}>
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

      <ul className="srv-list">
        {profiles.map((p) => (
          <li key={String(p.id)} className="srv-row">
            <span className="srv-type">{TYPE_LABEL[p.type] ?? '?'}</span>
            <span className="srv-name">{p.name}</span>
            <span className="muted mono">
              {p.address}:{String(p.port)}
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
        {profiles.length === 0 && <li className="muted">{t('srv.empty.d')}</li>}
      </ul>
    </div>
  );
}
