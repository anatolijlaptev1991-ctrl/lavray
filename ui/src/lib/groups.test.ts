// groups.test.ts — U-01: группа для нового сервера из редактора «Добавить».
// «Добавлены вручную» кладёт сервер в первую НЕ подписочную группу, «0» и пустая
// строка означают «группы нет» (ядро на group_id=0 отвечает invalid_argument).
import { describe, expect, it } from 'vitest';
import { Group_Kind } from '../gen/lavray_pb';
import { DEFAULT_GROUP_ID, MANUAL_FILTER, newServerGroupId } from './groups';
import type { GroupRef } from './groups';

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
