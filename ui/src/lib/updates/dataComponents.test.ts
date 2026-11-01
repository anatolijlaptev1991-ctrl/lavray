// SPDX-License-Identifier: GPL-3.0-only

// dataComponents.test.ts — наборы маршрутов и гео-данные через апдейтер (T-75/7.5):
// предложения из ответа проверки, доступность отката, события загрузки и
// применения → исходы. Чужие компоненты игнорируются; нарушение целостности
// получает свою причину, а не «нет обновлений».
import { describe, expect, it } from 'vitest';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import {
  CheckUpdatesResponseSchema,
  ComponentStateSchema,
  ComponentUpdateSchema,
  UpdateComponent,
  UpdateEventSchema,
  type UpdateEvent,
} from '../../gen/lavray_pb';
import { dataApplyOutcome, dataDownloadOutcome, dataOffers, dataRollbacks } from './dataComponents';

const event = (kind: NonNullable<MessageInitShape<typeof UpdateEventSchema>['kind']>): UpdateEvent =>
  create(UpdateEventSchema, { kind });

describe('dataOffers', () => {
  it('берёт предложения PRESETS и GEO, приложение игнорирует', () => {
    const res = create(CheckUpdatesResponseSchema, {
      available: [
        create(ComponentUpdateSchema, { component: UpdateComponent.APP, currentVersion: '1.0.0', availableVersion: '1.1.0' }),
        create(ComponentUpdateSchema, { component: UpdateComponent.PRESETS, currentVersion: 'lav-ru:2', availableVersion: 'lav-ru:3' }),
        create(ComponentUpdateSchema, { component: UpdateComponent.GEO, currentVersion: '', availableVersion: '2026-10-20' }),
      ],
    });
    expect(dataOffers(res)).toEqual({
      presets: { current: 'lav-ru:2', available: 'lav-ru:3' },
      geo: { current: '', available: '2026-10-20' },
    });
  });

  it('пустая версия предложения — предложения нет', () => {
    const res = create(CheckUpdatesResponseSchema, {
      available: [create(ComponentUpdateSchema, { component: UpdateComponent.PRESETS, currentVersion: 'lav-ru:2' })],
    });
    expect(dataOffers(res)).toEqual({});
  });
});

describe('dataRollbacks', () => {
  it('откат доступен только когда ядро это сказало; прошлая версия может быть пустой', () => {
    const states = [
      create(ComponentStateSchema, { component: UpdateComponent.APP, rollbackAvailable: true, previousVersion: '0.9.0' }),
      create(ComponentStateSchema, { component: UpdateComponent.PRESETS, rollbackAvailable: true, previousVersion: 'lav-ru:2' }),
      create(ComponentStateSchema, { component: UpdateComponent.GEO, rollbackAvailable: false }),
    ];
    expect(dataRollbacks(states)).toEqual({ presets: { previous: 'lav-ru:2' } });
    expect(
      dataRollbacks([create(ComponentStateSchema, { component: UpdateComponent.GEO, rollbackAvailable: true })]),
    ).toEqual({ geo: { previous: '' } });
  });
});

describe('dataDownloadOutcome', () => {
  const verified = (component: UpdateComponent): UpdateEvent =>
    event({ case: 'verified', value: { component, version: 'lav-ru:3', stagedPath: 'p', sha256: 'a'.repeat(64) } });

  it('verified своего компонента — загружено; чужого — пропуск', () => {
    expect(dataDownloadOutcome(verified(UpdateComponent.PRESETS), UpdateComponent.PRESETS)).toEqual({ kind: 'verified' });
    expect(dataDownloadOutcome(verified(UpdateComponent.GEO), UpdateComponent.PRESETS)).toBeNull();
  });

  it('прогресс — не итог', () => {
    const ev = event({ case: 'progress', value: { component: UpdateComponent.GEO, downloadedBytes: 1n, totalBytes: 2n } });
    expect(dataDownloadOutcome(ev, UpdateComponent.GEO)).toBeNull();
  });

  it.each([
    ['sha256_mismatch', 'upd.reason.sha256_mismatch'],
    ['truncated', 'upd.reason.truncated'],
    ['too_large', 'upd.reason.too_large'],
    ['something_new', 'upd.reason.generic'],
  ])('verify_failed %s → %s', (reason, key) => {
    const ev = event({ case: 'verifyFailed', value: { component: UpdateComponent.GEO, reason } });
    expect(dataDownloadOutcome(ev, UpdateComponent.GEO)).toEqual({ kind: 'failed', key });
  });

  it('failed (сеть) — «не удалось скачать»', () => {
    const ev = event({ case: 'failed', value: { component: UpdateComponent.GEO, code: 'network', message: 'x' } });
    expect(dataDownloadOutcome(ev, UpdateComponent.GEO)).toEqual({ kind: 'failed', key: 'upd.dlFailed' });
  });
});

describe('dataApplyOutcome', () => {
  it('applied — применено; ready_for_restart(profile) добавляет перезапуск', () => {
    expect(dataApplyOutcome(event({ case: 'applied', value: 'presets' }), UpdateComponent.PRESETS)).toEqual({ kind: 'applied' });
    expect(dataApplyOutcome(event({ case: 'readyForRestart', value: 'profile' }), UpdateComponent.PRESETS)).toEqual({
      kind: 'restart',
    });
  });

  it('applied чужого компонента и restart приложения не считаются', () => {
    expect(dataApplyOutcome(event({ case: 'applied', value: 'geo' }), UpdateComponent.PRESETS)).toBeNull();
    expect(dataApplyOutcome(event({ case: 'readyForRestart', value: 'app' }), UpdateComponent.PRESETS)).toBeNull();
  });

  it.each([
    ['archive_unsafe', 'upd.reason.archive_unsafe'],
    ['archive_limits', 'upd.reason.archive_limits'],
    ['geo_incomplete', 'upd.reason.geo_incomplete'],
    ['geo_invalid', 'upd.reason.geo_invalid'],
    ['preset_rejected', 'upd.reason.preset_rejected'],
    ['not_newer', 'upd.reason.not_newer'],
    ['sha256_mismatch', 'upd.reason.sha256_mismatch'],
  ])('verify_failed %s → %s', (reason, key) => {
    const ev = event({ case: 'verifyFailed', value: { component: UpdateComponent.GEO, reason } });
    expect(dataApplyOutcome(ev, UpdateComponent.GEO)).toEqual({ kind: 'failed', key });
  });
});
