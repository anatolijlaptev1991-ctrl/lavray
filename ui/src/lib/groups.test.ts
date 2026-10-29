// SPDX-License-Identifier: GPL-3.0-only

// groups.test.ts — U-01: группа для нового сервера из редактора «Добавить».
// «Добавлены вручную» кладёт сервер в первую НЕ подписочную группу, «0» и пустая
// строка означают «группы нет» (ядро на group_id=0 отвечает invalid_argument).
import { describe, expect, it } from 'vitest';
import { Group_Kind } from '../gen/lavray_pb';
import {
  DEFAULT_GROUP_ID,
  MANUAL_FILTER,
  groupDisplayName,
  importGroupId,
  newServerGroupId,
} from './groups';
import type { GroupRef } from './groups';
import { t } from './i18n';
import type { Language, MessageKey } from './i18n';

const SUB_ID = 77n;
const WORK_ID = 5n;

const SUB_FIRST: readonly GroupRef[] = [
  { id: SUB_ID, kind: Group_Kind.SUBSCRIPTION },
  { id: DEFAULT_GROUP_ID, kind: Group_Kind.BASIC },
  { id: WORK_ID, kind: Group_Kind.BASIC },
];

describe('U-01: группа для нового сервера', () => {
  it('«Добавлены вручную» — первая не подписочная группа, даже если первая в списке подписка', () => {
    expect(newServerGroupId(MANUAL_FILTER, String(SUB_ID), SUB_FIRST)).toBe(DEFAULT_GROUP_ID);
  });

  it('«Добавлены вручную» без загруженного списка или без не подписочной группы — null', () => {
    expect(newServerGroupId(MANUAL_FILTER, '', [])).toBeNull();
    expect(
      newServerGroupId(MANUAL_FILTER, String(SUB_ID), [{ id: SUB_ID, kind: Group_Kind.SUBSCRIPTION }]),
    ).toBeNull();
  });

  it('«Все» берёт текущую группу по умолчанию; пустая строка и «0» — группы нет', () => {
    expect(newServerGroupId('all', String(WORK_ID), SUB_FIRST)).toBe(WORK_ID);
    expect(newServerGroupId('all', '', SUB_FIRST)).toBeNull();
    expect(newServerGroupId('all', '0', SUB_FIRST)).toBeNull();
  });

  it('вкладка с конкретной группой отдаёт её id; фильтр «0» — группы нет', () => {
    expect(newServerGroupId(String(WORK_ID), '', SUB_FIRST)).toBe(WORK_ID);
    expect(newServerGroupId('0', String(WORK_ID), SUB_FIRST)).toBeNull();
  });
});

describe('U-01: группа для импорта', () => {
  it('«Добавлены вручную» импортирует в первую не подписочную группу, а не в подписку из начала списка', () => {
    expect(importGroupId(MANUAL_FILTER, String(SUB_ID), SUB_FIRST)).toBe(DEFAULT_GROUP_ID);
  });

  it('«Добавлены вручную» без не подписочной группы — группу не передаём, ядро выберет «Default»', () => {
    expect(importGroupId(MANUAL_FILTER, '', [])).toBeUndefined();
    expect(
      importGroupId(MANUAL_FILTER, String(SUB_ID), [{ id: SUB_ID, kind: Group_Kind.SUBSCRIPTION }]),
    ).toBeUndefined();
  });

  it('вкладка с группой — она; «Все» — текущая группа; «0» и пустая строка — группы нет', () => {
    expect(importGroupId(String(WORK_ID), '', SUB_FIRST)).toBe(WORK_ID);
    expect(importGroupId('all', String(WORK_ID), SUB_FIRST)).toBe(WORK_ID);
    expect(importGroupId('all', '', SUB_FIRST)).toBeUndefined();
    expect(importGroupId('0', String(WORK_ID), SUB_FIRST)).toBeUndefined();
  });
});

/** Перевод ключа на заданный язык (как t из i18n, но без текущего языка приложения). */
const inLang = (lang: Language) => (key: MessageKey): string => t(key, lang);

describe('U-03: отображаемое имя группы', () => {
  it.each([
    ['ru', 'Основная'],
    ['en', 'Default'],
    ['de', 'Standard'],
    ['es', 'Predeterminado'],
    ['zh', '默认'],
  ] as const)('встроенная группа «Default» в языке %s называется «%s»', (lang, name) => {
    expect(groupDisplayName({ id: DEFAULT_GROUP_ID, name: 'Default' }, inLang(lang))).toBe(name);
  });

  it('переименованная встроенная группа показывает своё имя', () => {
    expect(groupDisplayName({ id: DEFAULT_GROUP_ID, name: 'Мои серверы' }, inLang('ru'))).toBe('Мои серверы');
  });

  it('обычная группа с именем «Default» остаётся как есть: переводится только встроенная', () => {
    expect(groupDisplayName({ id: WORK_ID, name: 'Default' }, inLang('ru'))).toBe('Default');
    expect(groupDisplayName({ id: WORK_ID, name: 'Work' }, inLang('ru'))).toBe('Work');
  });
});
