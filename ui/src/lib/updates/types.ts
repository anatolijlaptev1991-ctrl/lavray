// SPDX-License-Identifier: GPL-3.0-only

// types.ts — типы автомата «Центра обновлений» (T-75). Состояния и действия —
// размеченные объединения; тексты ошибок хранятся ключами словаря, чтобы смена
// языка перевод не теряла.
import type { MessageKey } from '../i18n';
import type { Failure } from './errors';

/** Канал обновлений (настройка `update.channel`). */
export type Channel = 'stable' | 'beta';

/** Обновление приложения, которое нашла проверка. */
export interface AvailableUpdate {
  readonly version: string;
  readonly currentVersion: string;
  /** Обязательное: подписано в манифесте. Его бейдж — «Обязательное», не «Бета». */
  readonly mandatory: boolean;
  readonly channel: Channel;
  /** Заметки по локалям: только текст, никогда не разметка. */
  readonly notes: Readonly<Record<string, string>>;
}

/** Проверенная копия установщика в staging: ровно то, что просит `update_apply`. */
export interface StagedUpdate {
  readonly stagedPath: string;
  readonly sha256: string;
  readonly version: string;
}

/** Ошибка для показа: ключ понятного текста и сырая деталь от ядра (может быть пустой). */
export interface ErrorInfo {
  readonly key: MessageKey;
  readonly detail: string;
}

/** Что повторяет кнопка в состоянии ошибки. */
export type RetryTarget = 'check' | 'download' | 'install';

/** Версии приложения и ядра из ответа проверки. */
export interface Versions {
  readonly app: string;
  readonly core: string;
}

export type FlowState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'upToDate'; readonly versions: Versions }
  /** Проверка не удалась: это НЕ «обновлений нет». `note` — уточнение ядра (молчащее зеркало). */
  | { readonly kind: 'checkFailed'; readonly note: { readonly key: MessageKey; readonly detail: string } | null }
  /** В сборке нет корня доверия: проверять нечем. */
  | { readonly kind: 'notConfigured' }
  | { readonly kind: 'available'; readonly update: AvailableUpdate }
  | {
      readonly kind: 'downloading';
      readonly update: AvailableUpdate;
      readonly downloaded: number;
      readonly total: number;
      readonly bps: number;
    }
  | {
      readonly kind: 'ready';
      readonly update: AvailableUpdate;
      readonly staged: StagedUpdate;
      /** Пользователь отказал в UAC: ничего не установлено. */
      readonly notice: 'uacCancelled' | null;
      /** Нужно подтвердить установку при активной VPN-сессии. */
      readonly askSession: boolean;
    }
  | { readonly kind: 'installing'; readonly update: AvailableUpdate; readonly staged: StagedUpdate }
  | {
      readonly kind: 'error';
      readonly error: ErrorInfo;
      readonly retry: RetryTarget;
      readonly update: AvailableUpdate | null;
      readonly staged: StagedUpdate | null;
    };

export type FlowAction =
  | { readonly type: 'checkStart' }
  | { readonly type: 'checkDone'; readonly update: AvailableUpdate | null; readonly versions: Versions }
  | { readonly type: 'checkFailed'; readonly failure: Failure }
  | { readonly type: 'notConfigured' }
  | { readonly type: 'downloadStart' }
  | { readonly type: 'progress'; readonly downloaded: number; readonly total: number; readonly bps: number }
  | { readonly type: 'verified'; readonly staged: StagedUpdate }
  | { readonly type: 'downloadFailed'; readonly error: ErrorInfo; readonly retry: 'download' | 'check' }
  | { readonly type: 'downloadCancelled' }
  | { readonly type: 'installStart' }
  | { readonly type: 'needSessionConfirm' }
  | { readonly type: 'sessionDeclined' }
  | { readonly type: 'uacCancelled' }
  | { readonly type: 'installFailed'; readonly error: ErrorInfo; readonly retry: 'install' | 'download' }
  | { readonly type: 'channelChanged' }
  | { readonly type: 'dismiss' };
