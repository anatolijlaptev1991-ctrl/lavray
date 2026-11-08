// SPDX-License-Identifier: GPL-3.0-only

// ConnsTable: неизменные строки не перерисовываются при новом кадре потока
// (кадр приносит новые объекты с тем же содержимым).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Connection_Status } from '../../gen/lavray_pb';
import { conn } from '../../test-utils/connsKit';
import type { useI18n } from '../../hooks/useI18n';
import { ConnsTable } from './ConnsTable';
import { sameRow } from './sameRow';

const renders = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../hooks/useI18n', async (orig) => {
  const mod = await orig<{ useI18n: typeof useI18n }>();
  return { ...mod, useI18n: (): ReturnType<typeof useI18n> => { renders.n += 1; return mod.useI18n(); } };
});

describe('ConnsTable: мемоизация строк', () => {
  afterEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('новые объекты с тем же содержимым не перерисовывают строки; изменение — перерисовывает одну', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const onMenu = vi.fn();
    const closed = { status: Connection_Status.CLOSED, endedAtMs: 1_700_000_005_000n };
    const rowsOf = (extraUp = 0n): ReturnType<typeof conn>[] => [
      conn('a', closed),
      conn('b', closed),
      conn('c', { ...closed, uploadBytes: extraUp }),
    ];
    const show = (rows: ReturnType<typeof conn>[], nowMs: number): void => {
      act(() => { root.render(createElement(ConnsTable, { rows, nowMs, onMenu })); });
    };
    show(rowsOf(), 1_700_000_010_000);
    renders.n = 0;
    show(rowsOf(), 1_700_000_011_000); // новый кадр: те же закрытые соединения
    expect(renders.n).toBe(1); // только сама таблица
    renders.n = 0;
    show(rowsOf(2048n), 1_700_000_012_000);
    expect(renders.n).toBe(3); // таблица + изменившаяся строка + её значок статуса
    act(() => { root.unmount(); });
    host.remove();
  });

  it('sameRow: содержимое, длительность и обработчик решают', () => {
    const f = vi.fn();
    const base = { conn: conn('a'), duration: '1s', onMenu: f };
    expect(sameRow(base, { ...base, conn: conn('a') })).toBe(true);
    expect(sameRow(base, { ...base, duration: '2s' })).toBe(false);
    expect(sameRow(base, { ...base, onMenu: vi.fn() })).toBe(false);
    expect(sameRow(base, { ...base, conn: conn('a', { downloadBytes: 1n }) })).toBe(false);
  });
});
