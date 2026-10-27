// screen_connection.tsx — реальный экран «Подключение» (DS §8, FR-UI-032):
// статус-карточка ядра, сервер, переключатель режима, кнопка подключения.
// Данные — от живого ядра через ConnectRPC.
import { useCallback, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { ConnectMode, CoreState } from '../gen/lavray_pb';
import { useCore, useCoreStatus, useProfiles } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';

type Mode = 'sys' | 'tun';

export function ConnectionScreen(): JSX.Element {
  const { t } = useI18n();
  const core = useCore();
  const status = useCoreStatus();
  const { profiles } = useProfiles('');
  const [mode, setMode] = useState<Mode>('sys');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');

  const ready = status.state === CoreState.CONNECTED;
  const connecting = status.state === CoreState.CONNECTING;

  const activeProfile = useMemo(() => {
    if (status.activeProfileId === 0n) return undefined;
    return profiles.find((p) => p.id === status.activeProfileId);
  }, [profiles, status.activeProfileId]);

  const toggle = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      if (ready) {
        await core.core.disconnect({});
      } else {
        const target = activeProfile ?? profiles[0];
        if (target === undefined) {
          setError(t('scr.connection.sub'));
          return;
        }
        await core.core.connect({
          profileId: target.id,
          mode: mode === 'sys' ? ConnectMode.SYSTEM_PROXY : ConnectMode.TUN,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [core, mode, ready, activeProfile, profiles, t]);

  const stateLabel = useMemo(() => {
    switch (status.state) {
      case CoreState.CONNECTED:
        return t('conn.state.on');
      case CoreState.CONNECTING:
        return t('conn.state.connecting');
      case CoreState.ERROR:
        return t('conn.state.err');
      default:
        return t('conn.state.off');
    }
  }, [status.state, t]);

  return (
    <div className="conn">
      <div className="conn-card" data-state={status.state}>
        <div className="conn-mark" aria-hidden="true" />
        <div className="conn-text">
          <div className="conn-state" aria-live="polite" id="connState">
            {stateLabel}
          </div>
          {activeProfile !== undefined ? (
            <div className="conn-server">
              {activeProfile.name} · {activeProfile.address}:{String(activeProfile.port)}
            </div>
          ) : (
            <div className="conn-server">{t('conn.state.off.sub')}</div>
          )}
          {status.lastError !== '' && <div className="conn-err">{status.lastError}</div>}
        </div>
        <button className="btn primary" onClick={() => void toggle()} disabled={busy || connecting}>
          {ready ? t('conn.disconnect') : t('conn.connect')}
        </button>
      </div>

      <div className="seg" role="radiogroup" aria-label={t('mode.title')}>
        <button role="radio" aria-checked={mode === 'sys'} onClick={() => { setMode('sys'); }}>
          {t('mode.sys')}
        </button>
        <button role="radio" aria-checked={mode === 'tun'} onClick={() => { setMode('tun'); }}>
          {t('mode.tun')}
        </button>
      </div>

      {error !== '' && (
        <div className="toast-err" role="alert">
          {error}
        </div>
      )}

      <ul className="conn-list">
        {profiles.slice(0, 5).map((p) => (
          <li key={String(p.id)} className="conn-row">
            <span>{p.name}</span>
            <span className="muted">
              {p.address}:{String(p.port)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
