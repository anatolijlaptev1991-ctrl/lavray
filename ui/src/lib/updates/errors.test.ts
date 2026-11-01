// SPDX-License-Identifier: GPL-3.0-only

// errors.test.ts — разбор ошибок обновлений (T-75): причина FAILED_PRECONDITION
// из префикса `<reason>: …`, сетевая недоступность отдельно от отказов, коды
// оболочки → ключи словаря. Неизвестное никогда не показывается как «нет обновлений».
import { describe, expect, it } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';
import { classifyCoreError, parseReason, shellErrorKey, shellRetryTarget, verifyReasonKey } from './errors';

const precondition = (message: string): ConnectError => new ConnectError(message, Code.FailedPrecondition);

describe('parseReason', () => {
  it.each([
    'not_configured',
    'bad_signature',
    'expired',
    'serial_rollback',
    'wrong_product',
    'wrong_channel',
    'root_rotation',
    'artifact_role_missing',
    'clock_skew',
    'mirror_unreachable',
    'manifest_mismatch',
    'active_session',
  ])('%s: текст — известная причина и остаток', (reason) => {
    expect(parseReason(`${reason}: что-то пошло не так`)).toEqual({ reason, detail: 'что-то пошло не так' });
  });

  it('пробел после двоеточия необязателен, лишние пробелы срезаются', () => {
    expect(parseReason('expired:  срок  ')).toEqual({ reason: 'expired', detail: 'срок' });
    expect(parseReason('expired:срок')).toEqual({ reason: 'expired', detail: 'срок' });
  });

  it('неизвестный префикс, пустая строка и текст без причины — reason null', () => {
    expect(parseReason('weird_reason: x')).toEqual({ reason: null, detail: 'weird_reason: x' });
    expect(parseReason('')).toEqual({ reason: null, detail: '' });
    expect(parseReason('обновления не сконфигурированы')).toEqual({
      reason: null,
      detail: 'обновления не сконфигурированы',
    });
  });

  it('причина должна стоять в начале: «x bad_signature: …» — не причина', () => {
    expect(parseReason('x bad_signature: y').reason).toBeNull();
  });
});

describe('classifyCoreError', () => {
  it('UNAVAILABLE — сеть (проверка не удалась)', () => {
    expect(classifyCoreError(new ConnectError('all sources down', Code.Unavailable)).kind).toBe('network');
  });

  it('обрыв транспорта до ядра — тоже сеть, а не «нет обновлений»', () => {
    expect(classifyCoreError(new TypeError('Failed to fetch')).kind).toBe('network');
  });

  it('FAILED_PRECONDITION not_configured — честное состояние «не настроено»', () => {
    const f = classifyCoreError(precondition('not_configured: нет корня доверия'));
    expect(f.kind).toBe('notConfigured');
    expect(f.key).toBe('upd.notConfigured');
  });

  it('FAILED_PRECONDITION active_session — нужно подтверждение, не ошибка', () => {
    expect(classifyCoreError(precondition('active_session: VPN включён')).kind).toBe('activeSession');
  });

  it.each([
    ['bad_signature', 'upd.reason.bad_signature'],
    ['expired', 'upd.reason.expired'],
    ['serial_rollback', 'upd.reason.serial_rollback'],
    ['wrong_product', 'upd.reason.wrong_product'],
    ['wrong_channel', 'upd.reason.wrong_channel'],
    ['root_rotation', 'upd.reason.root_rotation'],
    ['artifact_role_missing', 'upd.reason.artifact_role_missing'],
    ['manifest_mismatch', 'upd.reason.manifest_mismatch'],
  ])('причина %s → отдельное сообщение %s', (reason, key) => {
    const f = classifyCoreError(precondition(`${reason}: подробности`));
    expect(f).toMatchObject({ kind: 'error', key, detail: 'подробности' });
  });

  it('FAILED_PRECONDITION без известной причины — общее сообщение, текст ядра в detail', () => {
    expect(classifyCoreError(precondition('что-то странное'))).toMatchObject({
      kind: 'error',
      key: 'upd.reason.generic',
      detail: 'что-то странное',
    });
  });

  it('ABORTED — загрузка уже идёт (вторую не начинаем)', () => {
    const f = classifyCoreError(new ConnectError('download in progress', Code.Aborted));
    expect(f).toMatchObject({ kind: 'running', key: 'upd.dlRunning' });
  });

  it('прочие коды и не-ошибки — общее сообщение', () => {
    expect(classifyCoreError(new ConnectError('boom', Code.Internal))).toMatchObject({
      kind: 'error',
      key: 'upd.err.generic',
    });
    expect(classifyCoreError('строка')).toMatchObject({ kind: 'error', key: 'upd.err.generic' });
    expect(classifyCoreError(null)).toMatchObject({ kind: 'error', key: 'upd.err.generic' });
  });
});

describe('verifyReasonKey: причина события verify_failed', () => {
  it('известные причины имеют свои тексты', () => {
    expect(verifyReasonKey('sha256_mismatch')).toBe('upd.reason.sha256_mismatch');
    expect(verifyReasonKey('truncated')).toBe('upd.reason.truncated');
    expect(verifyReasonKey('bad_signature')).toBe('upd.reason.bad_signature');
    expect(verifyReasonKey('not_configured')).toBe('upd.notConfigured');
  });

  it('неизвестная причина — общее сообщение (сырой текст не подставляется как ключ)', () => {
    expect(verifyReasonKey('что-то_новое')).toBe('upd.reason.generic');
    expect(verifyReasonKey('')).toBe('upd.reason.generic');
  });
});

describe('shellErrorKey: коды оболочки update_apply / update_rollback / update_pick_installer', () => {
  it.each([
    'busy',
    'path_outside_staging',
    'sha256_mismatch',
    'locked',
    'core_stop_failed',
    'launch_failed',
    'invalid_sha256',
    'proxy_release_failed',
    'prepare_failed',
    'invalid_version',
    'rollback_unavailable',
    'invalid_source',
    'too_large',
    'stage_failed',
    'signature_invalid',
    'version_mismatch',
    'core_unavailable',
    'installer_locked',
  ])('%s → upd.err.%s', (code) => {
    expect(shellErrorKey(code)).toBe(`upd.err.${code}`);
  });

  it('строка, Error и ConnectError разбираются одинаково', () => {
    expect(shellErrorKey('busy')).toBe('upd.err.busy');
    expect(shellErrorKey(new Error('busy'))).toBe('upd.err.busy');
    expect(shellErrorKey(' locked \n')).toBe('upd.err.locked');
  });

  it('неизвестный код, пустое и не-строка — общее сообщение', () => {
    expect(shellErrorKey('worker_failed')).toBe('upd.err.generic');
    expect(shellErrorKey('')).toBe('upd.err.generic');
    expect(shellErrorKey(undefined)).toBe('upd.err.generic');
    expect(shellErrorKey({ code: 'busy' })).toBe('upd.err.generic');
  });
});

describe('mirror_unreachable: зеркало метаданных молчит', () => {
  it('UNAVAILABLE с причиной — это «проверка не удалась», но с понятным текстом и именем зеркала', () => {
    const failure = classifyCoreError(
      new ConnectError('mirror_unreachable: cdn.jsdelivr.net, источник №2', Code.Unavailable),
    );
    expect(failure.kind).toBe('network');
    expect(failure.key).toBe('upd.reason.mirror_unreachable');
    expect(failure.detail).toBe('cdn.jsdelivr.net, источник №2');
  });

  it('UNAVAILABLE без причины остаётся обычным «проверка не удалась»', () => {
    const failure = classifyCoreError(new ConnectError('updates: все источники недоступны', Code.Unavailable));
    expect(failure).toEqual({ kind: 'network', key: 'upd.checkFailed', detail: '' });
  });
});

describe('clock_skew: часы компьютера отстают', () => {
  it('FAILED_PRECONDITION clock_skew имеет свой текст, а не «просрочено»', () => {
    const failure = classifyCoreError(
      new ConnectError('clock_skew: timestamp.expires дальше 7 дней', Code.FailedPrecondition),
    );
    expect(failure.kind).toBe('error');
    expect(failure.key).toBe('upd.reason.clock_skew');
    expect(verifyReasonKey('clock_skew')).toBe('upd.reason.clock_skew');
  });
});

describe('shellRetryTarget', () => {
  it('битая или подменённая копия — только новая загрузка, остальное — повтор установки', () => {
    for (const code of ['sha256_mismatch', 'path_outside_staging', 'invalid_sha256', 'invalid_version', 'signature_invalid', 'version_mismatch']) {
      expect(shellRetryTarget(code)).toBe('download');
    }
    for (const code of ['busy', 'locked', 'core_stop_failed', 'launch_failed', 'proxy_release_failed', 'prepare_failed', 'core_unavailable', 'x']) {
      expect(shellRetryTarget(code)).toBe('install');
    }
    expect(shellRetryTarget(new Error('sha256_mismatch'))).toBe('download');
  });
});
