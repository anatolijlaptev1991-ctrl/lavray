// SPDX-License-Identifier: GPL-3.0-only

// customFields.test.ts — что клиент считает custom-содержимым (T-08B). Правила
// совпадают с model.HasCustomContent ядра: иначе редактор не откроет диалог
// подтверждения там, где ядро откажется собирать конфиг.
import { describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { CustomDetail_Core, CustomDetailSchema, ProfileSchema } from '../gen/lavray_pb';
import type { Profile } from '../gen/lavray_pb';
import { hasCustomContent, isCustomJson, needsCustomConfirm } from './customFields';

function profile(init: Partial<Pick<Profile, 'customOutboundJson' | 'customConfigJson' | 'customFieldsConfirmed'>>): Profile {
  return create(ProfileSchema, init);
}

function customProfile(core: CustomDetail_Core, fullConfigJson: string): Profile {
  return create(ProfileSchema, {
    detail: { case: 'custom', value: create(CustomDetailSchema, { core, fullConfigJson }) },
  });
}

describe('isCustomJson', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['  \n\t', false],
    ['{}', false],
    [' { } ', false],
    ['{"a":1}', true],
    ['[]', true],
    ['null', true],
    ['{"a":', true],
  ])('%j → %s', (json, want) => {
    expect(isCustomJson(json)).toBe(want);
  });
});

describe('hasCustomContent', () => {
  it('нет custom-полей — нечего подтверждать', () => {
    expect(hasCustomContent(profile({}))).toBe(false);
  });

  it('пустой объект в обоих полях — нечего подтверждать', () => {
    expect(hasCustomContent(profile({ customOutboundJson: '{}', customConfigJson: ' {} ' }))).toBe(false);
  });

  it('любое из двух полей непусто — есть содержимое', () => {
    expect(hasCustomContent(profile({ customOutboundJson: '{"tls":{}}' }))).toBe(true);
    expect(hasCustomContent(profile({ customConfigJson: '{"dns":{}}' }))).toBe(true);
  });

  it('internal-full подтверждается всегда, даже с пустым конфигом (как в ядре)', () => {
    expect(hasCustomContent(customProfile(CustomDetail_Core.INTERNAL_FULL, ''))).toBe(true);
    expect(hasCustomContent(customProfile(CustomDetail_Core.INTERNAL_FULL, '{}'))).toBe(true);
  });

  it('custom-профиль с другим ядром — не custom-содержимое', () => {
    expect(hasCustomContent(customProfile(CustomDetail_Core.INTERNAL, '{"outbounds":[]}'))).toBe(false);
  });
});

describe('needsCustomConfirm', () => {
  it('содержимое есть и ядро его не подтвердило', () => {
    expect(needsCustomConfirm(profile({ customConfigJson: '{"dns":{}}' }))).toBe(true);
  });

  it('подтверждено ядром — диалог не нужен', () => {
    expect(needsCustomConfirm(profile({ customConfigJson: '{"dns":{}}', customFieldsConfirmed: true }))).toBe(false);
  });

  it('содержимого нет — флаг ядра не важен', () => {
    expect(needsCustomConfirm(profile({ customFieldsConfirmed: false }))).toBe(false);
  });
});
