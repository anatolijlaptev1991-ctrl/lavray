// SPDX-License-Identifier: GPL-3.0-only

// DialogShell.tsx — общая оболочка диалогов (.dlg-back/.dlg/.dlg-h/.dlg-b/.dlg-f
// из DS): портал на <body>, focus-trap, Esc, клик по фону. Вынесена из
// dialogs.tsx, чтобы диалоги в своих папках (backup, nekobox) не образовывали с
// ним цикл импортов.
import { useRef } from 'react';
import type { JSX, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../hooks/useI18n';
import { useModal } from '../hooks/useModal';
import { Icon } from './Icon';

interface ShellProps {
  readonly titleId: string;
  readonly title: string;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly onClose: () => void;
  readonly autofocusRef?: React.RefObject<HTMLElement | null>;
  /** false — клик по затемнению не закрывает диалог (формы и мастер: не терять ввод). */
  readonly dismissOnBackdrop?: boolean;
}

/** Оболочка диалога: focus-trap, Esc, клик по фону. */
export function DialogShell({
  titleId,
  title,
  size = 'sm',
  children,
  footer,
  onClose,
  autofocusRef,
  dismissOnBackdrop = true,
}: ShellProps): JSX.Element {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement | null>(null);

  // T-05: фокус ставится один раз при открытии (useModal читает onClose через
  // latest-ref), а не при каждом ререндере родителя.
  useModal(rootRef, { onClose, autofocusRef });

  // T-06: диалог рендерится в портале на <body>, а не внутри экрана. После
  // анимации .screen.active>* на предке остаётся transform, а он делает предка
  // containing block для position:fixed — диалог центрировался по высоте
  // списка серверов и уезжал за окно.
  return createPortal(
    <div
      className="dlg-back open"
      role="presentation"
      onClick={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`dlg dlg-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={rootRef}
        tabIndex={-1}
      >
        <div className="dlg-h">
          <h2 id={titleId}>{title}</h2>
          <button className="btn btn-ic btn-sm" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dlg-b">{children}</div>
        {footer !== undefined && <div className="dlg-f">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
