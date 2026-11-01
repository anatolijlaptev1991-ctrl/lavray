// SPDX-License-Identifier: GPL-3.0-only

// LazyBoundary.tsx — граница для лениво загружаемых экранов и диалогов (D-3):
// пока чанк грузится — невидимый статус для скринридера (role=status), при
// отказе загрузки — сообщение с «Повторить» вместо пустого экрана. «Повторить»
// перезагружает окно: браузер не запрашивает упавший модуль повторно (см.
// lazyView.ts). Ошибки рендера не перехватываются и идут выше, как и раньше.
import { Component, Suspense } from 'react';
import type { JSX, ReactNode } from 'react';
import { useI18n } from '../hooks/useI18n';
import { LazyLoadError } from '../lib/lazyView';
import { DialogShell } from './DialogShell';

interface LazyBoundaryProps {
  readonly children: ReactNode;
  /** Для диалога: закрыть окно, которое не удалось загрузить. */
  readonly onDismiss?: () => void;
}

interface CatcherState {
  readonly error: unknown;
  readonly hasError: boolean;
}

function LazyFallback(): JSX.Element {
  const { t } = useI18n();
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{t('lazy.loading')}</span>
    </div>
  );
}

function LazyFailed({ onDismiss }: { readonly onDismiss: (() => void) | undefined }): JSX.Element {
  const { t } = useI18n();
  const retry = (
    <button
      className="btn btn-pri"
      onClick={() => {
        window.location.reload();
      }}
    >
      {t('err.retry')}
    </button>
  );
  if (onDismiss !== undefined) {
    return (
      <DialogShell titleId="lazyFailedTitle" title={t('lazy.failed')} onClose={onDismiss} footer={retry}>
        <p role="alert">{t('lazy.failedHint')}</p>
      </DialogShell>
    );
  }
  return (
    <div className="empty" role="alert">
      <div className="empty-t">{t('lazy.failed')}</div>
      <div className="empty-d">{t('lazy.failedHint')}</div>
      {retry}
    </div>
  );
}

class Catcher extends Component<LazyBoundaryProps, CatcherState> {
  state: CatcherState = { error: null, hasError: false };

  static getDerivedStateFromError(error: unknown): CatcherState {
    return { error, hasError: true };
  }

  render(): ReactNode {
    const { error, hasError } = this.state;
    if (!hasError) return this.props.children;
    if (!(error instanceof LazyLoadError)) throw error; // не наша ошибка — выше
    return <LazyFailed onDismiss={this.props.onDismiss} />;
  }
}

export function LazyBoundary({ children, onDismiss }: LazyBoundaryProps): JSX.Element {
  return (
    <Catcher {...(onDismiss === undefined ? {} : { onDismiss })}>
      <Suspense fallback={<LazyFallback />}>{children}</Suspense>
    </Catcher>
  );
}
