// SPDX-License-Identifier: GPL-3.0-only

// flowReducer.test.ts — автомат «Центра обновлений» (T-75): idle → checking →
// available → downloading → ready → installing → error, плюс upToDate,
// checkFailed и notConfigured. Недопустимый переход возвращает то же состояние
// (тот же объект), поэтому лишний клик или запоздавшее событие ничего не ломают.
import { describe, expect, it } from 'vitest';
import { classifyCoreError } from './errors';
import { Code, ConnectError } from '@connectrpc/connect';
import { flowReducer, initialFlowState } from './flowReducer';
import type { AvailableUpdate, FlowAction, FlowState, StagedUpdate } from './types';

const UPDATE: AvailableUpdate = {
  version: '1.2.0',
  currentVersion: '1.1.0',
  mandatory: false,
  channel: 'stable',
  notes: { ru: 'Заметки' },
};
const STAGED: StagedUpdate = { stagedPath: 'C:\\s\\a.exe', sha256: 'b'.repeat(64), version: '1.2.0' };
const VERSIONS = { app: '1.1.0', core: '0.5.0' };

const run = (state: FlowState, ...actions: FlowAction[]): FlowState => actions.reduce(flowReducer, state);
const checking = (): FlowState => run(initialFlowState, { type: 'checkStart' });
const available = (): FlowState => run(checking(), { type: 'checkDone', update: UPDATE, versions: VERSIONS });
const downloading = (): FlowState => run(available(), { type: 'downloadStart' });
const ready = (): FlowState => run(downloading(), { type: 'verified', staged: STAGED });
const installing = (): FlowState => run(ready(), { type: 'installStart' });

describe('основной путь (H)', () => {
  it('idle → checking → available → downloading → ready → installing', () => {
    expect(initialFlowState).toEqual({ kind: 'idle' });
    expect(checking()).toEqual({ kind: 'checking' });
    expect(available()).toEqual({ kind: 'available', update: UPDATE });
    expect(downloading()).toMatchObject({ kind: 'downloading', update: UPDATE, downloaded: 0, total: 0, bps: 0 });
    expect(ready()).toEqual({ kind: 'ready', update: UPDATE, staged: STAGED, notice: null, askSession: false });
    expect(installing()).toEqual({ kind: 'installing', update: UPDATE, staged: STAGED });
  });

  it('progress обновляет счётчики', () => {
    const s = run(downloading(), { type: 'progress', downloaded: 10, total: 40, bps: 5 });
    expect(s).toMatchObject({ kind: 'downloading', downloaded: 10, total: 40, bps: 5 });
  });
});

describe('пустой и неуспешный результат проверки (E, R)', () => {
  it('нет обновления → upToDate с версиями', () => {
    const s = run(checking(), { type: 'checkDone', update: null, versions: VERSIONS });
    expect(s).toEqual({ kind: 'upToDate', versions: VERSIONS });
  });

  it('check_failed_is_not_no_updates: сеть → checkFailed, а не upToDate', () => {
    const failure = classifyCoreError(new ConnectError('all down', Code.Unavailable));
    const s = run(checking(), { type: 'checkFailed', failure });
    expect(s.kind).toBe('checkFailed');
    expect(s.kind).not.toBe('upToDate');
  });

  it('mirror_unreachable → checkFailed с названным зеркалом (текст и имя из ядра)', () => {
    const failure = classifyCoreError(new ConnectError('mirror_unreachable: a.example', Code.Unavailable));
    const s = run(checking(), { type: 'checkFailed', failure });
    expect(s).toEqual({ kind: 'checkFailed', note: { key: 'upd.reason.mirror_unreachable', detail: 'a.example' } });
    const plain = run(checking(), { type: 'checkFailed', failure: classifyCoreError(new ConnectError('x', Code.Unavailable)) });
    expect(plain).toEqual({ kind: 'checkFailed', note: null });
  });

  it('not_configured → notConfigured (честное состояние, без повторов)', () => {
    const failure = classifyCoreError(new ConnectError('not_configured: x', Code.FailedPrecondition));
    const s = run(checking(), { type: 'checkFailed', failure });
    expect(s.kind).toBe('notConfigured');
    // из notConfigured новая проверка не стартует: нет цикла «проверить — отказ»
    expect(flowReducer(s, { type: 'checkStart' })).toBe(s);
  });

  it('отказ проверки по причине → error с retry=check и ключом причины', () => {
    const failure = classifyCoreError(new ConnectError('bad_signature: плохо', Code.FailedPrecondition));
    const s = run(checking(), { type: 'checkFailed', failure });
    expect(s).toMatchObject({
      kind: 'error',
      retry: 'check',
      error: { key: 'upd.reason.bad_signature', detail: 'плохо' },
    });
  });

  it('GetUpdateState сообщил not_configured при открытии → notConfigured только из idle', () => {
    expect(flowReducer(initialFlowState, { type: 'notConfigured' }).kind).toBe('notConfigured');
    const s = available();
    expect(flowReducer(s, { type: 'notConfigured' })).toBe(s);
  });

  it('повторная проверка после checkFailed разрешена', () => {
    const failed = run(checking(), {
      type: 'checkFailed',
      failure: classifyCoreError(new ConnectError('x', Code.Unavailable)),
    });
    expect(flowReducer(failed, { type: 'checkStart' }).kind).toBe('checking');
  });
});

describe('недопустимые переходы возвращают то же состояние (I, D, C)', () => {
  it('двойной checkStart (двойной клик) — одно состояние', () => {
    const s = checking();
    expect(flowReducer(s, { type: 'checkStart' })).toBe(s);
  });

  it('двойной downloadStart — одно состояние (одна загрузка)', () => {
    const s = downloading();
    expect(flowReducer(s, { type: 'downloadStart' })).toBe(s);
  });

  it('downloadStart без доступного обновления игнорируется', () => {
    for (const s of [initialFlowState, checking(), ready(), installing()]) {
      expect(flowReducer(s, { type: 'downloadStart' })).toBe(s);
    }
  });

  it('installStart только из ready (или из error установки)', () => {
    for (const s of [initialFlowState, checking(), available(), downloading(), installing()]) {
      expect(flowReducer(s, { type: 'installStart' })).toBe(s);
    }
  });

  it('checkStart нельзя во время загрузки, готовности и установки', () => {
    for (const s of [downloading(), ready(), installing()]) {
      expect(flowReducer(s, { type: 'checkStart' })).toBe(s);
    }
  });

  it('checkDone / verified / progress вне своего состояния игнорируются', () => {
    const idle = initialFlowState;
    expect(flowReducer(idle, { type: 'checkDone', update: UPDATE, versions: VERSIONS })).toBe(idle);
    expect(flowReducer(available(), { type: 'verified', staged: STAGED })).toEqual(available());
    const a = available();
    expect(flowReducer(a, { type: 'progress', downloaded: 1, total: 2, bps: 3 })).toBe(a);
    expect(flowReducer(idle, { type: 'uacCancelled' })).toBe(idle);
    expect(flowReducer(idle, { type: 'dismiss' })).toBe(idle);
  });

  it('повторное verified в ready (дубль события) состояние не меняет', () => {
    const s = ready();
    expect(flowReducer(s, { type: 'verified', staged: STAGED })).toBe(s);
  });
});

describe('граничные значения прогресса (B)', () => {
  it('нулевой и неизвестный размер не ломают счётчики', () => {
    const s = run(downloading(), { type: 'progress', downloaded: 0, total: 0, bps: 0 });
    expect(s).toMatchObject({ downloaded: 0, total: 0 });
  });

  it('отрицательные и нечисловые значения приводятся к нулю', () => {
    const s = run(downloading(), { type: 'progress', downloaded: -5, total: Number.NaN, bps: -1 });
    expect(s).toMatchObject({ downloaded: 0, total: 0, bps: 0 });
  });
});

describe('отмена и таймаут потока (X)', () => {
  it('downloadCancelled возвращает в available, запоздавший progress игнорируется', () => {
    const s = run(downloading(), { type: 'downloadCancelled' });
    expect(s).toEqual({ kind: 'available', update: UPDATE });
    expect(flowReducer(s, { type: 'progress', downloaded: 9, total: 9, bps: 1 })).toBe(s);
    expect(flowReducer(s, { type: 'verified', staged: STAGED })).toBe(s);
  });

  it('отмена вне загрузки ничего не делает', () => {
    const s = ready();
    expect(flowReducer(s, { type: 'downloadCancelled' })).toBe(s);
  });
});

describe('частичный сбой и повтор (R)', () => {
  const error = { key: 'upd.reason.sha256_mismatch', detail: '' } as const;

  it('сбой загрузки → error с причиной и возможностью повторить загрузку', () => {
    const s = run(downloading(), { type: 'downloadFailed', error, retry: 'download' });
    expect(s).toEqual({ kind: 'error', error, retry: 'download', update: UPDATE, staged: null });
  });

  it('повтор загрузки из error стартует заново; из error с retry=check — нет', () => {
    const failed = run(downloading(), { type: 'downloadFailed', error, retry: 'download' });
    expect(flowReducer(failed, { type: 'downloadStart' }).kind).toBe('downloading');
    const stale = run(downloading(), { type: 'downloadFailed', error, retry: 'check' });
    expect(flowReducer(stale, { type: 'downloadStart' })).toBe(stale);
    expect(flowReducer(stale, { type: 'checkStart' }).kind).toBe('checking');
  });

  it('сбой установки → error с retry=install, повтор не требует новой загрузки', () => {
    const failed = run(installing(), {
      type: 'installFailed',
      error: { key: 'upd.err.locked', detail: '' },
      retry: 'install',
    });
    expect(failed).toMatchObject({ kind: 'error', retry: 'install', staged: STAGED, update: UPDATE });
    expect(flowReducer(failed, { type: 'installStart' })).toEqual(installing());
  });

  it('установщик в staging забракован → повтор только через новую загрузку', () => {
    const failed = run(installing(), {
      type: 'installFailed',
      error: { key: 'upd.err.sha256_mismatch', detail: '' },
      retry: 'download',
    });
    expect(flowReducer(failed, { type: 'installStart' })).toBe(failed);
    expect(flowReducer(failed, { type: 'downloadStart' }).kind).toBe('downloading');
  });

  it('смена канала сбрасывает устаревший результат проверки, но не трогает загрузку и установку', () => {
    expect(run(available(), { type: 'channelChanged' })).toEqual({ kind: 'idle' });
    expect(run(run(checking(), { type: 'checkDone', update: null, versions: VERSIONS }), { type: 'channelChanged' }).kind).toBe('idle');
    for (const s of [downloading(), ready(), installing(), checking()]) {
      expect(flowReducer(s, { type: 'channelChanged' })).toBe(s);
    }
  });

  it('dismiss из error возвращает к доступному обновлению (или в idle без него)', () => {
    const failed = run(downloading(), { type: 'downloadFailed', error, retry: 'download' });
    expect(flowReducer(failed, { type: 'dismiss' })).toEqual({ kind: 'available', update: UPDATE });
    const bare = run(checking(), {
      type: 'checkFailed',
      failure: classifyCoreError(new ConnectError('boom', Code.Internal)),
    });
    expect(flowReducer(bare, { type: 'dismiss' })).toEqual({ kind: 'idle' });
  });
});

describe('установка: UAC и активная сессия (X)', () => {
  it('uac_cancelled возвращает в ready с пометкой, следующий installStart её снимает', () => {
    const s = run(installing(), { type: 'uacCancelled' });
    expect(s).toEqual({ kind: 'ready', update: UPDATE, staged: STAGED, notice: 'uacCancelled', askSession: false });
    expect(run(s, { type: 'installStart' })).toEqual(installing());
  });

  it('активная сессия: ready с вопросом; отказ снимает вопрос; повтор работает', () => {
    const asking = run(installing(), { type: 'needSessionConfirm' });
    expect(asking).toMatchObject({ kind: 'ready', askSession: true, notice: null });
    expect(run(asking, { type: 'sessionDeclined' })).toMatchObject({ kind: 'ready', askSession: false });
    expect(run(asking, { type: 'installStart' }).kind).toBe('installing');
  });

  it('sessionDeclined вне вопроса состояние не меняет', () => {
    const s = ready();
    expect(flowReducer(s, { type: 'sessionDeclined' })).toBe(s);
  });
});
