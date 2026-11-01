// SPDX-License-Identifier: GPL-3.0-only

// appUpdate.test.ts — как ответ CheckUpdates превращается в «доступное обновление
// приложения» и как выбираются заметки по языку (T-75). Заметки — только текст.
import { describe, expect, it } from 'vitest';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import {
  type CheckUpdatesResponse,
  CheckUpdatesResponseSchema,
  type ComponentUpdate,
  ComponentUpdateSchema,
  UpdateChannel,
  UpdateComponent,
  UpdateManifestSchema,
} from '../../gen/lavray_pb';
import { appUpdateOf, pickNotes, versionsOf } from './appUpdate';

const comp = (init: MessageInitShape<typeof ComponentUpdateSchema>): ComponentUpdate =>
  create(ComponentUpdateSchema, init);
const response = (...available: ComponentUpdate[]): CheckUpdatesResponse =>
  create(CheckUpdatesResponseSchema, { available, currentAppVersion: '1.1.0', coreVersion: '0.5.0' });

describe('appUpdateOf', () => {
  it('APP с availableVersion → обновление с версиями, флагом и заметками', () => {
    const res = response(
      comp({
        component: UpdateComponent.APP,
        currentVersion: '1.1.0',
        availableVersion: '1.2.0',
        mandatory: true,
        notes: { ru: 'что нового' },
      }),
    );
    expect(appUpdateOf(res, 'stable')).toEqual({
      version: '1.2.0',
      currentVersion: '1.1.0',
      mandatory: true,
      channel: 'stable',
      notes: { ru: 'что нового' },
    });
  });

  it('пустой ответ, чужие компоненты и пустая версия — обновления нет (E)', () => {
    expect(appUpdateOf(response(), 'stable')).toBeNull();
    expect(appUpdateOf(response(comp({ component: UpdateComponent.CORE, availableVersion: '9.9.9' })), 'stable')).toBeNull();
    expect(appUpdateOf(response(comp({ component: UpdateComponent.APP })), 'stable')).toBeNull();
    expect(appUpdateOf(response(comp({ component: UpdateComponent.APP, availableVersion: '' })), 'stable')).toBeNull();
  });

  it('канал берётся из подписанного манифеста, иначе — из запроса', () => {
    const beta = comp({
      component: UpdateComponent.APP,
      availableVersion: '1.2.0-beta.1',
      manifest: create(UpdateManifestSchema, { channel: UpdateChannel.BETA }),
    });
    expect(appUpdateOf(response(beta), 'stable')?.channel).toBe('beta');
    const stable = comp({
      component: UpdateComponent.APP,
      availableVersion: '1.2.0',
      manifest: create(UpdateManifestSchema, { channel: UpdateChannel.STABLE }),
    });
    expect(appUpdateOf(response(stable), 'beta')?.channel).toBe('stable');
    const bare = comp({ component: UpdateComponent.APP, availableVersion: '1.2.0' });
    expect(appUpdateOf(response(bare), 'beta')?.channel).toBe('beta');
  });

  it('нет заметок у компонента — берутся заметки манифеста', () => {
    const c = comp({
      component: UpdateComponent.APP,
      availableVersion: '1.2.0',
      manifest: create(UpdateManifestSchema, { notes: { en: 'from manifest' } }),
    });
    expect(appUpdateOf(response(c), 'stable')?.notes).toEqual({ en: 'from manifest' });
  });
});

describe('versionsOf', () => {
  it('версии приложения и ядра из ответа', () => {
    expect(versionsOf(response())).toEqual({ app: '1.1.0', core: '0.5.0' });
  });
});

describe('pickNotes', () => {
  const notes = { en: 'English', ru: 'Русский', 'de-DE': 'Deutsch' };

  it('точный язык, затем локаль с регионом, затем английский, затем любой', () => {
    expect(pickNotes(notes, 'ru')).toBe('Русский');
    expect(pickNotes(notes, 'de')).toBe('Deutsch');
    expect(pickNotes({ en: 'English', fr: 'Français' }, 'es')).toBe('English');
    expect(pickNotes({ fr: 'Français' }, 'es')).toBe('Français');
  });

  it('пусто → пустая строка; пробелы срезаются; пустые значения пропускаются', () => {
    expect(pickNotes({}, 'ru')).toBe('');
    expect(pickNotes({ ru: '   ' }, 'ru')).toBe('');
    expect(pickNotes({ ru: '', en: ' ok ' }, 'ru')).toBe('ok');
  });

  it('очень длинные заметки обрезаются (экран не раздувается)', () => {
    const long = 'x'.repeat(20_000);
    const out = pickNotes({ ru: long }, 'ru');
    expect(out.length).toBeLessThan(long.length);
    expect(out.endsWith('…')).toBe(true);
  });
});
