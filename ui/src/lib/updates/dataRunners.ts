// SPDX-License-Identifier: GPL-3.0-only

// dataRunners.ts — два шага для наборов маршрутов и гео-данных (T-75/7.5):
// «обновить» (загрузка с проверкой, затем применение; ядро не применит то, что не
// скачано и не прошло проверку) и «откатить». Каждый шаг ходит в ядро и
// возвращает исход; React тут не нужен. Установщик и оболочка не нужны: данные
// ложатся в каталог данных ядром.
import type { UpdateEvent } from '../../gen/lavray_pb';
import type { CoreClients } from '../core';
import type { MessageKey } from '../i18n';
import { dataApplyOutcome, dataComponentOf, dataDownloadOutcome } from './dataComponents';
import type { DataKind } from './dataComponents';
import { classifyCoreError } from './errors';
import { readStream } from './stream';

/** Сколько можно молчать стриму загрузки или применения (мс). */
export const DATA_IDLE_MS = 90_000;

export type DataResult =
  | { readonly kind: 'applied'; readonly restart: boolean }
  | { readonly kind: 'rolledBack'; readonly restart: boolean }
  | { readonly kind: 'failed'; readonly key: MessageKey }
  | { readonly kind: 'cancelled' };

const failed = (key: MessageKey): DataResult => ({ kind: 'failed', key });

/** Ошибка RPC → ключ текста: «уже идёт» — своё сообщение, остальное по причине ядра. */
function rpcFailure(e: unknown): DataResult {
  const f = classifyCoreError(e);
  return failed(f.kind === 'running' ? 'upd.comp.busy' : f.kind === 'network' ? 'upd.dlFailed' : f.key);
}

type Step = { readonly kind: 'ok' } | DataResult;

/** Читает стрим до итогового события; без итога — `fallback`. */
async function drain(
  open: (signal: AbortSignal) => AsyncIterable<UpdateEvent>,
  onEvent: (ev: UpdateEvent) => void,
  signal: AbortSignal,
): Promise<'done' | 'cancelled' | 'stalled'> {
  return readStream(open, onEvent, { signal, idleMs: DATA_IDLE_MS });
}

async function download(core: CoreClients, kind: DataKind, signal: AbortSignal): Promise<Step> {
  const comp = dataComponentOf(kind);
  const seen: { outcome: ReturnType<typeof dataDownloadOutcome> } = { outcome: null };
  try {
    const end = await drain(
      (s) => core.updates.downloadUpdates({ components: [comp] }, { signal: s }),
      (ev) => {
        seen.outcome ??= dataDownloadOutcome(ev, comp);
      },
      signal,
    );
    if (seen.outcome?.kind === 'verified') return { kind: 'ok' };
    if (seen.outcome !== null) return failed(seen.outcome.key);
    return end === 'cancelled' ? { kind: 'cancelled' } : failed(end === 'stalled' ? 'upd.stalled' : 'upd.dlFailed');
  } catch (e) {
    return rpcFailure(e);
  }
}

async function apply(core: CoreClients, kind: DataKind, signal: AbortSignal): Promise<DataResult> {
  const comp = dataComponentOf(kind);
  const seen = { applied: false, restart: false, failure: null as MessageKey | null };
  try {
    const end = await drain(
      (s) => core.updates.applyUpdates({ components: [comp] }, { signal: s }),
      (ev) => {
        const o = dataApplyOutcome(ev, comp);
        if (o?.kind === 'applied') seen.applied = true;
        else if (o?.kind === 'restart') seen.restart = true;
        else if (o?.kind === 'failed') seen.failure ??= o.key;
      },
      signal,
    );
    if (seen.failure !== null) return failed(seen.failure);
    if (seen.applied) return { kind: 'applied', restart: seen.restart };
    return end === 'cancelled' ? { kind: 'cancelled' } : failed(end === 'stalled' ? 'upd.stalled' : 'upd.err.generic');
  } catch (e) {
    return rpcFailure(e);
  }
}

/** Обновить компонент: скачать и проверить, затем применить. */
export async function installData(core: CoreClients, kind: DataKind, signal: AbortSignal): Promise<DataResult> {
  const got = await download(core, kind, signal);
  if (got.kind !== 'ok') return got;
  return apply(core, kind, signal);
}

/** Вернуть прошлую ревизию компонента. */
export async function rollbackData(core: CoreClients, kind: DataKind): Promise<DataResult> {
  try {
    const res = await core.updates.rollback({ component: dataComponentOf(kind) });
    return res.success ? { kind: 'rolledBack', restart: res.needsProfileRestart } : failed('upd.err.generic');
  } catch (e) {
    return rpcFailure(e);
  }
}
