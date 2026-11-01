// SPDX-License-Identifier: GPL-3.0-only

// lazyView.ts — React.lazy, у которого отказ загрузки чанка помечен ошибкой
// LazyLoadError (D-3). LazyBoundary по ней отличает обрыв сети от ошибки
// рендера. Повтор в том же документе бесполезен: браузер запоминает неудачную
// загрузку модуля по адресу, поэтому «Повторить» перезагружает окно.
import { lazy } from 'react';
import type { ComponentType } from 'react';

/** Чанк не загрузился (сеть, 404 после обновления); `cause` — исходная ошибка. */
export class LazyLoadError extends Error {
  constructor(cause: unknown) {
    super('lazy chunk failed to load', { cause });
    this.name = 'LazyLoadError';
  }
}

/** Ленивый компонент: `load` вызывается при первом показе. */
export function lazyView<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  return lazy(() =>
    load().then(
      (component) => ({ default: component }),
      (cause: unknown) => {
        throw new LazyLoadError(cause);
      },
    ),
  ) as unknown as ComponentType<P>;
}
