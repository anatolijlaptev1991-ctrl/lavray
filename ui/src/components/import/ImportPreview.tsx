// SPDX-License-Identifier: GPL-3.0-only

// ImportPreview.tsx — предпросмотр импорта: число серверов и первые восемь строк
// (имя, бейдж «не поддерживается ядром», адрес). Вынесено из ImportDialog.tsx
// (размерная трещотка).
import type { JSX } from 'react';
import type { Profile } from '../../gen/lavray_pb';
import { useI18n } from '../../hooks/useI18n';
import { Icon } from '../Icon';
import { UnsupportedBadge } from '../servers/UnsupportedBadge';

/** Сколько строк предпросмотра показывается. */
const SHOWN = 8;

interface Props {
  readonly profiles: readonly Profile[];
  /** Ссылка оказалась подпиской: список серверов не показывается. */
  readonly isSubscription: boolean;
}

export function ImportPreview({ profiles, isSubscription }: Props): JSX.Element {
  const { t, plural } = useI18n();
  return (
    <div className="card" style={{ background: 'var(--surface2)', marginTop: 12 }}>
      <div className="card-h" style={{ marginBottom: 8 }}>
        <span className="ic"><Icon name="search" /></span>
        <h3 style={{ fontSize: '.875rem', fontWeight: 600 }}>
          {isSubscription ? t('imp.prev.subUrl') : plural('pl.p', profiles.length)}
        </h3>
      </div>
      {!isSubscription && (
        <ul className="imp-prev-list">
          {profiles.slice(0, SHOWN).map((p, i) => (
            <li key={`${String(p.type)}-${String(i)}`}>
              <span className="mono">{p.name}</span>
              <UnsupportedBadge reason={p.unsupportedReason} />
              <span className="muted mono">
                {p.address}:{String(p.port)}
              </span>
            </li>
          ))}
          {profiles.length > SHOWN && <li className="muted">…</li>}
        </ul>
      )}
    </div>
  );
}
