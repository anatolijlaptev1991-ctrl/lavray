// SPDX-License-Identifier: GPL-3.0-only

// ConnStatusIcon.tsx — значок статуса соединения (FR-UI-213): активное — точка,
// закрытое — history, заблокированное — cancel. Иконок history/cancel в общем
// наборе Icon нет, поэтому рисуем их здесь (Lucide: сетка 24, штрих 1.75, как у Icon).
// Смысл дублируется скрытым текстом: значок один цвет, текст читает скринридер.
import type { JSX } from 'react';
import { Connection_Status } from '../../gen/lavray_pb';
import type { MessageKey } from '../../lib/i18n';
import { useI18n } from '../../hooks/useI18n';

type Shown = 'active' | 'closed' | 'blocked';

const LABEL: Readonly<Record<Shown, MessageKey>> = {
  active: 'conns.st.active',
  closed: 'conns.st.closed',
  blocked: 'conns.st.blocked',
};

function shownStatus(status: Connection_Status): Shown {
  if (status === Connection_Status.BLOCKED) return 'blocked';
  return status === Connection_Status.CLOSED ? 'closed' : 'active';
}

const SHAPES: Readonly<Record<Exclude<Shown, 'active'>, JSX.Element>> = {
  closed: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </>
  ),
  blocked: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </>
  ),
};

export function ConnStatusIcon({ status }: { readonly status: Connection_Status }): JSX.Element {
  const { t } = useI18n();
  const shown = shownStatus(status);
  const label = t(LABEL[shown]);
  return (
    <span className={`conn-st conn-st-${shown}`} data-status={shown} title={label}>
      {shown === 'active' ? (
        <span className="dot ok" />
      ) : (
        <svg
          className="ic"
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {SHAPES[shown]}
        </svg>
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}
