// SPDX-License-Identifier: GPL-3.0-only

// UpdateStatusCard.tsx — карточка состояния «Центра обновлений» (T-75): по
// состоянию автомата показывает проверку, «последняя версия», найденное
// обновление с главным действием, установку или ошибку. Логики здесь нет —
// только выбор представления.
import type { JSX } from 'react';
import type { UpdateFlowApi } from '../../hooks/useUpdateFlow';
import {
  CheckFailedBanner,
  CheckingNotice,
  ErrorBanner,
  InstallingNotice,
  NotConfiguredNotice,
  UpToDateCard,
} from './StatusNotices';
import { UpdateOfferCard } from './UpdateOfferCard';

export function UpdateStatusCard({ flow }: { readonly flow: UpdateFlowApi }): JSX.Element | null {
  const { state } = flow;
  switch (state.kind) {
    case 'idle':
      return null;
    case 'checking':
      return <CheckingNotice />;
    case 'upToDate':
      return <UpToDateCard versions={state.versions} />;
    case 'checkFailed':
      return <CheckFailedBanner flow={flow} note={state.note} />;
    case 'notConfigured':
      return <NotConfiguredNotice />;
    case 'installing':
      return <InstallingNotice />;
    case 'error':
      return <ErrorBanner state={state} flow={flow} />;
    case 'available':
    case 'downloading':
    case 'ready':
      return <UpdateOfferCard state={state} flow={flow} />;
  }
}
