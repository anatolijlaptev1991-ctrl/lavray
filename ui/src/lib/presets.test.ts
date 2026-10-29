// presets.test.ts — названия и описания пресетов берутся из словаря (T-41).
import { describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { RoutingPresetSchema } from '../gen/lavray_pb';
import { LANGUAGES, t, type MessageKey } from './i18n';
import { presetDescription, presetRuleCount, presetTitle } from './presets';

// Идентификаторы файлов core/internal/presets/builtin/*.json; displayName
// встроенного ядро отдаёт как «preset.<id>» (api/convert.go: presetToProto).
const CORE_BUILTIN = ['lav-ru', 'lav-cn', 'global', 'all-proxy', 'all-direct'];

describe('presetTitle / presetDescription', () => {
  it.each(LANGUAGES)('%s: у каждого встроенного пресета ядра есть название и описание, а не ключ', (lang) => {
    const tr = (key: MessageKey): string => t(key, lang);
    for (const id of CORE_BUILTIN) {
      expect(presetTitle(id, `preset.${id}`, tr), `${lang}/${id}`).not.toMatch(/^preset\./);
      const desc = presetDescription(id, tr);
      expect(desc, `${lang}/${id}`).toBeTruthy();
      expect(desc, `${lang}/${id}`).not.toMatch(/^preset\./);
    }
  });

  it('бренды LAV Preset не переводятся, остальные — по языку', () => {
    expect(presetTitle('lav-ru', 'preset.lav-ru', (k) => t(k, 'zh'))).toBe('LAV Preset RU');
    expect(presetTitle('global', 'preset.global', (k) => t(k, 'ru'))).toBe('Глобальный');
    expect(presetTitle('global', 'preset.global', (k) => t(k, 'de'))).toBe('Global');
  });

  it('свой пресет показывается как есть, у него нет описания; неизвестный встроенный — по id', () => {
    const tr = (key: MessageKey): string => t(key, 'en');
    expect(presetTitle('u123', 'My preset', tr)).toBe('My preset');
    expect(presetDescription('u123', tr)).toBeNull();
    expect(presetTitle('lav-xx', 'preset.lav-xx', tr)).toBe('lav-xx');
  });

  it('presetRuleCount: записи всех списков и процессные правила', () => {
    const p = create(RoutingPresetSchema, {
      proxyDomain: ['a', 'b'],
      directIp: ['c'],
      blockDomain: ['d'],
      processRules: [{ processNames: ['x.exe'] }],
    });
    expect(presetRuleCount(p)).toBe(5);
  });
});
