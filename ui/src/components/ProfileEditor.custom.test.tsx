// SPDX-License-Identifier: GPL-3.0-only

// ProfileEditor.custom.test.tsx — T-08B: «Custom outbound JSON» / «Custom config JSON»
// в редакторе профиля. Поля есть у любого типа, проверяются по мере ввода, а невалидный
// JSON не даёт сохранить. Подтверждение (diff-диалог) — отдельные тесты ниже.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { ProfileSchema, ProfileType, UpdateProfileResponseSchema } from '../gen/lavray_pb';
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
