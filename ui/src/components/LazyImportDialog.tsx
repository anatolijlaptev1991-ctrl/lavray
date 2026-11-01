// SPDX-License-Identifier: GPL-3.0-only

// LazyImportDialog.tsx — диалог импорта как отдельный чанк (D-3): он тянет QR-
// библиотеки jsQR и qrcode-generator (около трети бандла), а открывается редко.
// Те же свойства, что у ImportDialog; не загрузился — окно с «Повторить» и
// «Закрыть» (LazyBoundary), закрытие зовёт onClose.
import type { ComponentProps, JSX } from 'react';
import { lazyView } from '../lib/lazyView';
import type { ImportDialog as ImportDialogType } from './ImportDialog';
import { LazyBoundary } from './LazyBoundary';

const ImportDialog = lazyView(() => import('./ImportDialog').then((m) => m.ImportDialog));

export function LazyImportDialog(props: ComponentProps<typeof ImportDialogType>): JSX.Element {
  return (
    <LazyBoundary onDismiss={props.onClose}>
      <ImportDialog {...props} />
    </LazyBoundary>
  );
}
