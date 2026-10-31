// SPDX-License-Identifier: GPL-3.0-only

// ProfileEditor.custom.test.tsx — T-08B: «Custom outbound JSON» / «Custom config JSON»
// в редакторе профиля. Поля есть у любого типа, проверяются по мере ввода, а невалидный
// JSON не даёт сохранить. Подтверждение (diff-диалог) — отдельные тесты ниже.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  CustomDetail_Core,
  CustomDetailSchema,
  PreviewCustomFieldsResponseSchema,
  ProfileSchema,
  ProfileType,
  UpdateProfileResponseSchema,
} from '../gen/lavray_pb';
import type { Profile } from '../gen/lavray_pb';
import type { CoreClients } from '../lib/core';
import { setLanguage, t, tf } from '../lib/i18n';
import { buttonByText, click, flush, makeClients, mountWithCore, profileOf } from '../test-harness';
import type { Mounted } from '../test-harness';
import { ProfileEditor } from './ProfileEditor';

const GROUP = 10n;
const OUT_ID = 'edCustomOut';
const CFG_ID = 'edCustomCfg';

interface Rig {
  readonly clients: CoreClients;
  readonly create: MockInstance<CoreClients['profiles']['createProfile']>;
  readonly update: MockInstance<CoreClients['profiles']['updateProfile']>;
  readonly onSaved: ReturnType<typeof vi.fn>;
  readonly onClose: ReturnType<typeof vi.fn>;
  readonly mounted: Mounted;
}

const byId = (id: string): HTMLInputElement | HTMLTextAreaElement => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`нет элемента #${id}`);
  return el as HTMLInputElement | HTMLTextAreaElement;
};

/** Ввод в управляемое поле React: нативный setter + событие input. */
function setValue(id: string, value: string): void {
  const el = byId(id);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Минимально валидный VLESS-профиль в форме (тип по умолчанию — VMess, поэтому выбираем плитку). */
function fillVless(): void {
  const tile = Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]')).find(
    (b) => (b.querySelector('.n')?.textContent ?? '').trim() === 'VLESS',
  );
  act(() => {
    tile?.click();
  });
  setValue('edRemark', 'Node');
  setValue('edAddr', 'v.example.org');
  setValue('edPort', '443');
  setValue('edf-secret', '12345678-90ab-cdef-1234-567890abcdef');
}

/** reply — как ядро «сохранило» присланный профиль (по умолчанию: как есть). */
async function mount(profile: Profile | null, reply: (sent: Profile) => Profile = (p) => p): Promise<Rig> {
  const clients = makeClients({ profiles: [profileOf(1, 'Node A')] });
  const echo = (init: MessageInitShape<typeof ProfileSchema> | undefined): Profile => reply(create(ProfileSchema, init));
  const createSpy = vi
    .spyOn(clients.profiles, 'createProfile')
    .mockImplementation((req) => Promise.resolve(echo(req.profile)));
  const updateSpy = vi
    .spyOn(clients.profiles, 'updateProfile')
    .mockImplementation((req) => Promise.resolve(create(UpdateProfileResponseSchema, { profile: echo(req.profile) })));
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const mounted = await mountWithCore(
    clients,
    createElement(ProfileEditor, { profile, groupId: GROUP, onClose, onSaved }),
  );
  return { clients, create: createSpy, update: updateSpy, onSaved, onClose, mounted };
}

const saveButton = (): HTMLButtonElement => buttonByText(document.body, t('common.save'));
const fieldError = (id: string): string => (byId(id).closest('.field')?.querySelector('.field-err')?.textContent ?? '').trim();

describe('ProfileEditor: custom JSON (T-08B)', () => {
  let rig: Rig | undefined;

  beforeEach(() => {
    setLanguage('en');
    window.localStorage.clear();
  });
  afterEach(() => {
    rig?.mounted.unmount();
    rig = undefined;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('оба поля есть у профиля любого типа, подписаны и у нового профиля пусты', async () => {
    rig = await mount(null);
    for (const [id, label] of [[OUT_ID, t('cf.outbound')], [CFG_ID, t('cf.config')]] as const) {
      expect(byId(id)).toBeInstanceOf(HTMLTextAreaElement);
      expect(document.querySelector(`label[for="${id}"]`)?.textContent).toBe(label);
      expect(byId(id).value).toBe('');
    }
    expect(byId(OUT_ID).getAttribute('aria-describedby')).toBe(`${OUT_ID}-hint`);
    expect(document.getElementById(`${OUT_ID}-hint`)?.textContent).toBe(t('cf.outboundHint'));
  });

  it('введённые custom-поля уходят в CreateProfile как есть; пустое поле не отправляется', async () => {
    rig = await mount(null);
    fillVless();
    setValue(OUT_ID, '{"tls":{"insecure":false}}');
    await click(saveButton());
    const sent = rig.create.mock.calls[0]?.[0].profile;
    expect(sent?.customOutboundJson).toBe('{"tls":{"insecure":false}}');
    expect(sent?.customConfigJson).toBeUndefined();
    expect(sent?.customFieldsConfirmed).toBe(false);
  });

  it('правка: поля подставлены из профиля, очистка поля уходит в UpdateProfile', async () => {
    const existing = create(ProfileSchema, {
      ...profileOf(7, 'Edit me'),
      customOutboundJson: '{"a":1}',
      customConfigJson: '{"dns":{}}',
    });
    rig = await mount(existing);
    expect(byId(OUT_ID).value).toBe('{"a":1}');
    expect(byId(CFG_ID).value).toBe('{"dns":{}}');
    setValue(OUT_ID, '  ');
    setValue(CFG_ID, '{"dns":{"servers":[]}}');
    await click(saveButton());
    const sent = rig.update.mock.calls[0]?.[0].profile;
    expect(sent?.customOutboundJson).toBeUndefined();
    expect(sent?.customConfigJson).toBe('{"dns":{"servers":[]}}');
  });

  it('invalid_json_blocks_save: ошибка с позицией у поля, фокус на нём, CreateProfile не вызван', async () => {
    rig = await mount(null);
    fillVless();
    setValue(CFG_ID, '{ bad json');
    expect(fieldError(CFG_ID)).toBe(tf('cf.err.syntaxAt', { line: 1, col: 3 }));
    expect(byId(CFG_ID).getAttribute('aria-invalid')).toBe('true');
    await click(saveButton());
    expect(rig.create).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(byId(CFG_ID));
    expect(rig.onSaved).not.toHaveBeenCalled();

    setValue(CFG_ID, '{"dns":{}}');
    expect(fieldError(CFG_ID)).toBe('');
    await click(saveButton());
    expect(rig.create).toHaveBeenCalledTimes(1);
  });

  it('не объект и слишком большой JSON — свои сообщения; ошибка раскрывает свёрнутый блок', async () => {
    rig = await mount(null);
    fillVless();
    setValue(OUT_ID, '[1,2]');
    expect(fieldError(OUT_ID)).toBe(t('ed.jsonObj'));
    setValue(OUT_ID, `{"a":"${'x'.repeat(256 * 1024)}"}`);
    expect(fieldError(OUT_ID)).toBe(tf('cf.err.tooLarge', { kb: 256 }));
    expect(document.querySelector('details.fold[open]')).not.toBeNull();
    await click(saveButton());
    expect(rig.create).not.toHaveBeenCalled();
    await flush(5);
  });

  it('{} и пустая строка допустимы и сохраняются без ошибок', async () => {
    rig = await mount(null);
    fillVless();
    setValue(OUT_ID, '{}');
    setValue(CFG_ID, '   ');
    expect(fieldError(OUT_ID)).toBe('');
    await click(saveButton());
    expect(rig.create).toHaveBeenCalledTimes(1);
    expect(rig.onSaved).toHaveBeenCalledTimes(1);
  });

  it('поля доступны и у типа «Свой JSON» (JSON самого типа остаётся отдельным полем)', async () => {
    const outbound = create(ProfileSchema, { ...profileOf(8, 'J'), type: ProfileType.CUSTOM_OUTBOUND });
    rig = await mount(outbound);
    expect(document.getElementById(OUT_ID)).not.toBeNull();
    expect(document.getElementById('edf-json')).not.toBeNull();
  });

});

describe('ProfileEditor: подтверждение custom-полей после сохранения (T-08B)', () => {
  let rig: Rig | undefined;
  const HASH = 'c'.repeat(64);
  const DIFF = ['--- before', '+++ after', '@@ -1 +1 @@', '-a', '+b'].join('\n');
  const SAVED_ID = 55n;
  /** Ядро сохранило профиль и (как и положено) не подтвердило custom-поля. */
  const saved = (p: Profile): Profile => create(ProfileSchema, { ...p, id: SAVED_ID, customFieldsConfirmed: false });

  beforeEach(() => {
    setLanguage('en');
    window.localStorage.clear();
  });
  afterEach(() => {
    rig?.mounted.unmount();
    rig = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  /** Превью и подтверждение ядра: превью отдаёт HASH, подтверждение — профиль с флагом. */
  function stubConfirm(r: Rig): {
    preview: MockInstance<CoreClients['profiles']['previewCustomFields']>;
    confirm: MockInstance<CoreClients['profiles']['confirmCustomFields']>;
  } {
    const preview = vi
      .spyOn(r.clients.profiles, 'previewCustomFields')
      .mockResolvedValue(create(PreviewCustomFieldsResponseSchema, { customHash: HASH, diff: DIFF }));
    const confirm = vi
      .spyOn(r.clients.profiles, 'confirmCustomFields')
      .mockResolvedValue(create(ProfileSchema, { id: SAVED_ID, customFieldsConfirmed: true }));
    return { preview, confirm };
  }
  const dialogs = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
  const cfDialog = (): HTMLElement | undefined => dialogs().find((d) => d.querySelector('#cfdTitle') !== null);

  it('saving_custom_json_opens_diff_dialog: после сохранения открывается diff, редактор ждёт', async () => {
    rig = await mount(null, saved);
    const { preview, confirm } = stubConfirm(rig);
    fillVless();
    setValue(OUT_ID, '{"tls":{"insecure":false}}');
    await click(saveButton());

    expect(rig.create).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledWith({ profileId: SAVED_ID });
    expect(cfDialog()).toBeDefined();
    expect(dialogs()).toHaveLength(2); // редактор остаётся под диалогом подтверждения
    expect(rig.onSaved).not.toHaveBeenCalled();
    expect(rig.onClose).not.toHaveBeenCalled();

    const box = cfDialog()?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await click(box);
    await click(buttonByText(cfDialog() ?? document.body, t('cf.apply')));
    expect(confirm).toHaveBeenCalledWith({ profileId: SAVED_ID, customHash: HASH });
    expect(rig.onSaved).toHaveBeenCalledTimes(1);
    expect(rig.onClose).toHaveBeenCalledTimes(1);
    expect(cfDialog()).toBeUndefined();
  });

  it('закрыть диалог подтверждения без согласия: профиль сохранён, редактор завершается, подтверждения нет', async () => {
    rig = await mount(null, saved);
    const { confirm } = stubConfirm(rig);
    fillVless();
    setValue(CFG_ID, '{"dns":{"servers":[]}}');
    await click(saveButton());
    await click(buttonByText(cfDialog() ?? document.body, t('common.cancel')));
    expect(confirm).not.toHaveBeenCalled();
    expect(rig.onSaved).toHaveBeenCalledTimes(1);
    expect(rig.onClose).toHaveBeenCalledTimes(1);
  });

  it('правка профиля с custom-полями: UpdateProfile, затем тот же диалог по id из ответа', async () => {
    const existing = create(ProfileSchema, { ...profileOf(7, 'Edit'), customOutboundJson: '{"a":1}' });
    rig = await mount(existing, saved);
    const { preview } = stubConfirm(rig);
    setValue(OUT_ID, '{"a":2}');
    await click(saveButton());
    expect(rig.update).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledWith({ profileId: SAVED_ID });
    expect(cfDialog()).toBeDefined();
  });

  it('no_custom_no_dialog: без custom-полей редактор завершается сразу', async () => {
    rig = await mount(null, saved);
    const { preview } = stubConfirm(rig);
    fillVless();
    await click(saveButton());
    expect(preview).not.toHaveBeenCalled();
    expect(cfDialog()).toBeUndefined();
    expect(rig.onSaved).toHaveBeenCalledTimes(1);
    expect(rig.onClose).toHaveBeenCalledTimes(1);
  });

  it('empty_object_no_dialog: {} и пробелы — не custom-содержимое, подтверждать нечего', async () => {
    rig = await mount(null, saved);
    const { preview } = stubConfirm(rig);
    fillVless();
    setValue(OUT_ID, '{}');
    setValue(CFG_ID, ' { } ');
    await click(saveButton());
    expect(preview).not.toHaveBeenCalled();
    expect(cfDialog()).toBeUndefined();
    expect(rig.onSaved).toHaveBeenCalledTimes(1);
  });

  it('ядро уже считает содержимое подтверждённым (хэш не менялся) — диалога нет', async () => {
    const existing = create(ProfileSchema, { ...profileOf(7, 'Same'), customOutboundJson: '{"a":1}', customFieldsConfirmed: true });
    rig = await mount(existing, (p) => create(ProfileSchema, { ...p, customFieldsConfirmed: true }));
    const { preview } = stubConfirm(rig);
    await click(saveButton());
    expect(preview).not.toHaveBeenCalled();
    expect(rig.onSaved).toHaveBeenCalledTimes(1);
  });

  it('internal_full_opens_dialog: профиль CUSTOM_CONFIG (полный конфиг) подтверждается и без custom-полей', async () => {
    const full = create(ProfileSchema, {
      ...profileOf(9, 'Full'),
      type: ProfileType.CUSTOM_CONFIG,
      address: '',
      port: 0,
      detail: {
        case: 'custom',
        value: create(CustomDetailSchema, { core: CustomDetail_Core.INTERNAL_FULL, fullConfigJson: '{"log":{"level":"info"}}' }),
      },
    });
    rig = await mount(full, saved);
    const { preview } = stubConfirm(rig);
    await click(saveButton());
    expect(preview).toHaveBeenCalledWith({ profileId: SAVED_ID });
    expect(cfDialog()).toBeDefined();
  });

  it('ошибка сохранения: диалога подтверждения нет, баннер ошибки в редакторе', async () => {
    rig = await mount(null, saved);
    const { preview } = stubConfirm(rig);
    rig.create.mockRejectedValueOnce(new Error('[invalid_argument] duplicate key "a"'));
    fillVless();
    setValue(OUT_ID, '{"a":1,"a":2}');
    await click(saveButton());
    expect(preview).not.toHaveBeenCalled();
    expect(document.querySelector('.banner-err')?.textContent).toContain('duplicate key');
    expect(rig.onSaved).not.toHaveBeenCalled();
  });
});
