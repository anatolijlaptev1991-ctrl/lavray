// SPDX-License-Identifier: GPL-3.0-only

// flowReducer.ts — чистый автомат «Центра обновлений» (T-75). Недопустимый
// переход возвращает то же состояние (тот же объект): лишний клик, дубль или
// запоздавшее событие потока ничего не ломают и не вызывают перерисовку.
import type { Failure } from './errors';
import type { AvailableUpdate, FlowAction, FlowState } from './types';

export const initialFlowState: FlowState = { kind: 'idle' };

/** Из каких состояний можно начать проверку (из notConfigured — нельзя: без цикла отказов). */
const CAN_CHECK: ReadonlySet<FlowState['kind']> = new Set(['idle', 'upToDate', 'checkFailed', 'available', 'error']);

/** Состояния, где результат проверки относится к прежнему каналу и после смены канала устарел. */
const CHANNEL_RESETS: ReadonlySet<FlowState['kind']> = new Set(['upToDate', 'checkFailed', 'available']);

/** Кнопка «Проверить сейчас» доступна, пока автомат принимает проверку. */
export const canCheck = (state: FlowState): boolean => CAN_CHECK.has(state.kind);

const nonNegative = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

/** Результат неудачной проверки: сеть и «не настроено» — свои состояния, остальное — ошибка. */
function afterCheckFailure(failure: Failure): FlowState {
  if (failure.kind === 'network') {
    const specific = failure.key !== 'upd.checkFailed';
    return { kind: 'checkFailed', note: specific ? { key: failure.key, detail: failure.detail } : null };
  }
  if (failure.kind === 'notConfigured') return { kind: 'notConfigured' };
  return {
    kind: 'error',
    error: { key: failure.key, detail: failure.detail },
    retry: 'check',
    update: null,
    staged: null,
  };
}

function reduceCheck(state: FlowState, action: FlowAction): FlowState | null {
  switch (action.type) {
    case 'checkStart':
      return CAN_CHECK.has(state.kind) ? { kind: 'checking' } : state;
    case 'checkDone':
      if (state.kind !== 'checking') return state;
      return action.update === null
        ? { kind: 'upToDate', versions: action.versions }
        : { kind: 'available', update: action.update };
    case 'checkFailed':
      return state.kind === 'checking' ? afterCheckFailure(action.failure) : state;
    case 'notConfigured':
      return state.kind === 'idle' ? { kind: 'notConfigured' } : state;
    default:
      return null;
  }
}

/** Обновление, которое можно скачать: из «доступно» или из ошибки загрузки. */
function downloadSource(state: FlowState): AvailableUpdate | null {
  if (state.kind === 'available') return state.update;
  if (state.kind === 'error' && state.retry === 'download') return state.update;
  return null;
}

function reduceDownload(state: FlowState, action: FlowAction): FlowState | null {
  switch (action.type) {
    case 'downloadStart': {
      const update = downloadSource(state);
      return update === null ? state : { kind: 'downloading', update, downloaded: 0, total: 0, bps: 0 };
    }
    case 'progress':
      return state.kind === 'downloading'
        ? {
            ...state,
            downloaded: nonNegative(action.downloaded),
            total: nonNegative(action.total),
            bps: nonNegative(action.bps),
          }
        : state;
    case 'verified':
      return state.kind === 'downloading'
        ? { kind: 'ready', update: state.update, staged: action.staged, notice: null, askSession: false }
        : state;
    case 'downloadFailed':
      return state.kind === 'downloading'
        ? { kind: 'error', error: action.error, retry: action.retry, update: state.update, staged: null }
        : state;
    case 'downloadCancelled':
      return state.kind === 'downloading' ? { kind: 'available', update: state.update } : state;
    default:
      return null;
  }
}

/** Установка стартует из «готово» или повторяется после ошибки установки (копия в staging цела). */
function startInstall(state: FlowState): FlowState {
  if (state.kind === 'ready') return { kind: 'installing', update: state.update, staged: state.staged };
  if (state.kind === 'error' && state.retry === 'install' && state.update !== null && state.staged !== null) {
    return { kind: 'installing', update: state.update, staged: state.staged };
  }
  return state;
}

function reduceInstall(state: FlowState, action: FlowAction): FlowState | null {
  switch (action.type) {
    case 'installStart':
      return startInstall(state);
    case 'needSessionConfirm':
      return state.kind === 'installing' ? { ...state, kind: 'ready', notice: null, askSession: true } : state;
    case 'sessionDeclined':
      return state.kind === 'ready' && state.askSession ? { ...state, askSession: false } : state;
    case 'uacCancelled':
      return state.kind === 'installing'
        ? { ...state, kind: 'ready', notice: 'uacCancelled', askSession: false }
        : state;
    case 'installFailed':
      return state.kind === 'installing'
        ? { kind: 'error', error: action.error, retry: action.retry, update: state.update, staged: state.staged }
        : state;
    case 'channelChanged':
      return CHANNEL_RESETS.has(state.kind) ? { kind: 'idle' } : state;
    case 'dismiss':
      if (state.kind !== 'error') return state;
      return state.update === null ? { kind: 'idle' } : { kind: 'available', update: state.update };
    default:
      return null;
  }
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  return reduceCheck(state, action) ?? reduceDownload(state, action) ?? reduceInstall(state, action) ?? state;
}
