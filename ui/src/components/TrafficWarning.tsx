// SPDX-License-Identifier: GPL-3.0-only

// TrafficWarning.tsx — предупреждение «Подключено, но через сервер ничего не
// проходит» на экране «Подключение» (0.2.1). Ядро после подключения один раз
// запрашивает тестовый адрес через сервер; если запрос не прошёл, причина
// приходит в CoreStatus.health_error. Код типовой причины переводится, прочий
// текст показывается как есть. Разметка баннера — как у TunAdminNotice.
import type { JSX } from 'react';
import { useI18n } from '../hooks/useI18n';
import type { MessageKey } from '../lib/i18n';
import { Icon } from './Icon';

/** Коды типовых причин ядра (core/internal/api/connect_health.go) → подпись. */
const REASON_KEYS: Readonly<Record<string, MessageKey>> = {
  refused: 'conn.noTraffic.refused',
  reset: 'conn.noTraffic.reset',
  no_host: 'conn.noTraffic.no_host',
  timeout: 'conn.noTraffic.timeout',
};

export function TrafficWarning({ reason }: { readonly reason: string }): JSX.Element {
  const { t, tf } = useI18n();
  const key = REASON_KEYS[reason];
  return (
    <div
      className="banner banner-warn"
      id="connNoTraffic"
      role="alert"
      style={{ gridColumn: '1 / -1', marginBottom: 0 }}
    >
      <span className="ic">
        <Icon name="alert" />
      </span>
      <div className="bn-t">
        {tf('conn.noTraffic', { reason: key === undefined ? reason : t(key) })}
      </div>
    </div>
  );
}
