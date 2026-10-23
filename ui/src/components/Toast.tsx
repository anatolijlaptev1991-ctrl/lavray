/**
 * Toast (stub): single role="status" region, auto-dismiss, Esc closes
 * (DS §6 Toast; motion per DS §11 — plain opacity here).
 */
import { useEffect } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../hooks/useI18n';

export interface ToastState {
  readonly id: number;
  readonly message: string;
}

export interface ToastProps {
  readonly toast: ToastState | null;
  readonly onClose: () => void;
}

const TOAST_MS = 3200;

export function Toast({ toast, onClose }: ToastProps): JSX.Element | null {
  const { t } = useI18n();

  useEffect(() => {
    if (toast === null) return undefined;
    const timer = window.setTimeout(onClose, TOAST_MS);
    return (): void => {
      window.clearTimeout(timer);
    };
  }, [toast, onClose]);
  if (toast === null) return null;

  return (
    <div className="toast" role="status">
      <span>{toast.message}</span>
      <button type="button" className="btn btn-sm" onClick={onClose}>
        {t('common.close')}
      </button>
    </div>
  );
}
