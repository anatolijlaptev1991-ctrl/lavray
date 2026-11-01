// SPDX-License-Identifier: GPL-3.0-only

// events.test.ts — события стримов DownloadUpdates / ApplyUpdates → действия
// автомата (T-75). Главное: `verified` без пути или суммы не делает обновление
// «готовым», отказ проверки получает свою причину, чужие компоненты игнорируются.
import { describe, expect, it } from 'vitest';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { UpdateComponent, UpdateEventSchema, type UpdateEvent } from '../../gen/lavray_pb';
import { applySignal, downloadAction } from './events';

const event = (kind: NonNullable<MessageInitShape<typeof UpdateEventSchema>['kind']>): UpdateEvent =>
  create(UpdateEventSchema, { kind });
const SHA = 'c'.repeat(64);

describe('downloadAction', () => {
  it('progress → progress с числами', () => {
    const ev = event({
      case: 'progress',
      value: { component: UpdateComponent.APP, downloadedBytes: 10n, totalBytes: 40n, bps: 2.5 },
    });
    expect(downloadAction(ev, '1.0.0')).toEqual({ type: 'progress', downloaded: 10, total: 40, bps: 2.5 });
  });

  it('verified → staged с путём и суммой из события, версия — из события', () => {
    const ev = event({
      case: 'verified',
      value: { component: UpdateComponent.APP, version: '1.2.0', stagedPath: 'C:\\s\\a.exe', sha256: SHA },
    });
    expect(downloadAction(ev, '9.9.9')).toEqual({
      type: 'verified',
      staged: { stagedPath: 'C:\\s\\a.exe', sha256: SHA, version: '1.2.0' },
    });
  });

  it('verified без версии берёт версию найденного обновления', () => {
    const ev = event({ case: 'verified', value: { component: UpdateComponent.APP, stagedPath: 'p', sha256: SHA } });
    expect(downloadAction(ev, '1.2.0')).toMatchObject({ staged: { version: '1.2.0' } });
  });

  it.each([
    ['без пути', { stagedPath: '', sha256: SHA }],
    ['без суммы', { stagedPath: 'p', sha256: '' }],
  ])('verified %s — это сбой, а не «готово» (ядро без staging)', (_name, fields) => {
    const ev = event({ case: 'verified', value: { component: UpdateComponent.APP, version: '1.2.0', ...fields } });
    expect(downloadAction(ev, '1.2.0')).toMatchObject({
      type: 'downloadFailed',
      error: { key: 'upd.dlFailed' },
      retry: 'download',
    });
  });

  it('verifyFailed → отказ с причиной; подмена данных — повтор через новую проверку, битый файл — через загрузку', () => {
    const sig = event({ case: 'verifyFailed', value: { component: UpdateComponent.APP, reason: 'bad_signature' } });
    expect(downloadAction(sig, '1')).toEqual({
      type: 'downloadFailed',
      error: { key: 'upd.reason.bad_signature', detail: '' },
      retry: 'check',
    });
    const sum = event({ case: 'verifyFailed', value: { component: UpdateComponent.APP, reason: 'sha256_mismatch' } });
    expect(downloadAction(sum, '1')).toMatchObject({ error: { key: 'upd.reason.sha256_mismatch' }, retry: 'download' });
    const odd = event({ case: 'verifyFailed', value: { component: UpdateComponent.APP, reason: 'новое' } });
    expect(downloadAction(odd, '1')).toMatchObject({ error: { key: 'upd.reason.generic' }, retry: 'download' });
  });

  it('failed: восстановимый — повтор загрузки, невосстановимый — новая проверка; текст ядра в detail', () => {
    const net = event({ case: 'failed', value: { component: UpdateComponent.APP, code: 'net', message: 'reset', recoverable: true } });
    expect(downloadAction(net, '1')).toEqual({
      type: 'downloadFailed',
      error: { key: 'upd.dlFailed', detail: 'reset' },
      retry: 'download',
    });
    const fatal = event({ case: 'failed', value: { component: UpdateComponent.APP, code: 'sig', message: 'no', recoverable: false } });
    expect(downloadAction(fatal, '1')).toMatchObject({ retry: 'check' });
  });

  it('события чужих компонентов и посторонние виды игнорируются', () => {
    const core = event({ case: 'progress', value: { component: UpdateComponent.CORE, downloadedBytes: 1n, totalBytes: 2n } });
    expect(downloadAction(core, '1')).toBeNull();
    expect(downloadAction(event({ case: 'readyForRestart', value: 'x' }), '1')).toBeNull();
    expect(downloadAction(event({ case: undefined }), '1')).toBeNull();
  });

  it('component=UNSPECIFIED считается приложением (старое ядро не заполняет поле)', () => {
    const ev = event({ case: 'progress', value: { downloadedBytes: 1n, totalBytes: 2n } });
    expect(downloadAction(ev, '1')).toMatchObject({ type: 'progress' });
  });
});

describe('applySignal', () => {
  it('readyForRestart → ready', () => {
    expect(applySignal(event({ case: 'readyForRestart', value: 'restart' }))).toEqual({ kind: 'ready' });
  });

  it('verifyFailed при повторной проверке — копия в staging забракована, нужна новая загрузка', () => {
    const ev = event({ case: 'verifyFailed', value: { component: UpdateComponent.APP, reason: 'sha256_mismatch' } });
    expect(applySignal(ev)).toEqual({
      kind: 'failed',
      error: { key: 'upd.reason.sha256_mismatch', detail: '' },
      retry: 'download',
    });
  });

  it('failed: восстановимый — повтор установки, иначе новая загрузка', () => {
    const soft = event({ case: 'failed', value: { component: UpdateComponent.APP, code: 'x', message: 'm', recoverable: true } });
    expect(applySignal(soft)).toMatchObject({ kind: 'failed', retry: 'install', error: { key: 'upd.err.generic', detail: 'm' } });
    const hard = event({ case: 'failed', value: { component: UpdateComponent.APP, code: 'x', message: 'm', recoverable: false } });
    expect(applySignal(hard)).toMatchObject({ retry: 'download' });
  });

  it('прогресс и прочее не сигналы', () => {
    expect(applySignal(event({ case: 'progress', value: { downloadedBytes: 1n } }))).toBeNull();
    expect(applySignal(event({ case: 'applied', value: 'app' }))).toBeNull();
  });
});
