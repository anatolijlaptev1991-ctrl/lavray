// SPDX-License-Identifier: GPL-3.0-only

// dataComponents.ts — наборы маршрутов и гео-данные через апдейтер (T-75/7.5):
// предложения из ответа CheckUpdates, доступность отката из GetUpdateState и
// события стримов DownloadUpdates / ApplyUpdates → исходы. Чистые функции без
// побочных эффектов; тексты ошибок — ключами словаря (смена языка перевод не теряет).
import { UpdateComponent } from '../../gen/lavray_pb';
import type { CheckUpdatesResponse, ComponentState, UpdateEvent } from '../../gen/lavray_pb';
import type { MessageKey } from '../i18n';
import { verifyReasonKey } from './errors';

/** Компонент-данные: доставляется файлом, а не установщиком, и применяется без перезапуска приложения. */
export type DataKind = 'presets' | 'geo';

export const DATA_KINDS: readonly DataKind[] = ['presets', 'geo'];

export const dataComponentOf = (kind: DataKind): UpdateComponent =>
  kind === 'presets' ? UpdateComponent.PRESETS : UpdateComponent.GEO;

const kindOf = (c: UpdateComponent): DataKind | null =>
  c === UpdateComponent.PRESETS ? 'presets' : c === UpdateComponent.GEO ? 'geo' : null;

/** Что нашла проверка: действующая и доступная ревизии (строки ядра: «lav-ru:3», дата среза). */
export interface DataOffer {
  readonly current: string;
  readonly available: string;
}

/** Предложения PRESETS и GEO из ответа проверки; пустая доступная версия — предложения нет. */
export function dataOffers(res: CheckUpdatesResponse): Partial<Record<DataKind, DataOffer>> {
  const out: Partial<Record<DataKind, DataOffer>> = {};
  for (const u of res.available) {
    const kind = kindOf(u.component);
    const available = u.availableVersion ?? '';
    if (kind !== null && available !== '') out[kind] = { current: u.currentVersion, available };
  }
  return out;
}

/** Откат компонента: прошлая ревизия (пустая — поставка из приложения). */
export interface DataRollback {
  readonly previous: string;
}

/** Откаты, о которых сообщило ядро (`rollback_available`). */
export function dataRollbacks(states: readonly ComponentState[]): Partial<Record<DataKind, DataRollback>> {
  const out: Partial<Record<DataKind, DataRollback>> = {};
  for (const s of states) {
    const kind = kindOf(s.component);
    if (kind !== null && s.rollbackAvailable) out[kind] = { previous: s.previousVersion ?? '' };
  }
  return out;
}

export type DownloadOutcome = { readonly kind: 'verified' } | { readonly kind: 'failed'; readonly key: MessageKey };

/** Итог по событию загрузки; `null` — событие не итоговое или чужого компонента. */
export function dataDownloadOutcome(ev: UpdateEvent, comp: UpdateComponent): DownloadOutcome | null {
  const { kind } = ev;
  switch (kind.case) {
    case 'verified':
      return kind.value.component === comp ? { kind: 'verified' } : null;
    case 'verifyFailed':
      return kind.value.component === comp ? { kind: 'failed', key: verifyReasonKey(kind.value.reason) } : null;
    case 'failed':
      return kind.value.component === comp ? { kind: 'failed', key: 'upd.dlFailed' } : null;
    default:
      return null;
  }
}

export type ApplyOutcome =
  | { readonly kind: 'applied' }
  /** Данные работающего профиля изменились: профиль нужно переподключить. */
  | { readonly kind: 'restart' }
  | { readonly kind: 'failed'; readonly key: MessageKey };

/** Итог по событию применения. `applied` несёт имя компонента ядра («presets», «geo»). */
export function dataApplyOutcome(ev: UpdateEvent, comp: UpdateComponent): ApplyOutcome | null {
  const { kind } = ev;
  switch (kind.case) {
    case 'applied':
      return kind.value === (comp === UpdateComponent.PRESETS ? 'presets' : 'geo') ? { kind: 'applied' } : null;
    case 'readyForRestart':
      return kind.value === 'profile' ? { kind: 'restart' } : null;
    case 'verifyFailed':
      return kind.value.component === comp ? { kind: 'failed', key: verifyReasonKey(kind.value.reason) } : null;
    default:
      return null;
  }
}
