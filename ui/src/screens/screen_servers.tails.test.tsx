// SPDX-License-Identifier: GPL-3.0-only

// screen_servers.tails.test.tsx — «Серверы»: действия меню строки (перенос в группу,
// дублирование, сброс трафика, разрешение доменов, экспорт конфига), очистка
// (пробный прогон → список → подтверждение), сводка трафика группы и бейдж XHTTP
// (хвосты B, 7.1 и 7.4). Ядро подставное, сеть не нужна.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import {
  CloneProfilesResponseSchema,
  DeduplicateResponseSchema,
  ExportConfigRequest_Purpose,
  ExportConfigResponseSchema,
  GetTrafficSummaryResponseSchema,
  GroupTrafficSummarySchema,
  Group_Kind,
  ProfileSchema,
  RemoveUnavailableResponseSchema,
  ResolveDomainsResponseSchema,
  ResolveFailureSchema,
} from '../gen/lavray_pb';
import type { CoreClients } from '../lib/core';
import { setLanguage } from '../lib/i18n';
import { buttonByText, click, DEFAULT_GROUP_ID, flush, groupOf, makeClients, mountWithCore, profileOf } from '../test-harness';
import type { Mounted } from '../test-harness';
import { ServersScreen } from './screen_servers';

const saveFile = vi.hoisted(() => vi.fn<(name: string, ext: string, data: string) => Promise<string>>());
vi.mock('../lib/saveFile', () => ({ saveFile }));

const SUB_GROUP = 2147482999n;
const WORK_GROUP = 5n;

beforeEach(() => {
  setLanguage('en');
  window.localStorage.clear();
  saveFile.mockReset();
  saveFile.mockResolvedValue('saved');
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

interface Screen extends Mounted {
  readonly clients: CoreClients;
}

async function mountServers(extra: { xhttp?: boolean } = {}): Promise<Screen> {
  const profiles = [profileOf(1, 'S1'), profileOf(2, 'S2')];
  if (extra.xhttp === true) {
    profiles.push(create(ProfileSchema, { ...profileOf(3, 'XH'), unsupportedReason: 'xhttp_unsupported' }));
  }
  const clients = makeClients({
    profiles,
    groups: [
      groupOf(DEFAULT_GROUP_ID, 'Default'),
      groupOf(SUB_GROUP, 'Provider sub'),
      groupOf(WORK_GROUP, 'Work'),
    ].map((g) => (g.id === SUB_GROUP ? { ...g, kind: Group_Kind.SUBSCRIPTION } : g)),
  });
  const m = await mountWithCore(clients, createElement(ServersScreen));
  return { ...m, clients };
}

const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]');
const status = (c: HTMLElement): string => c.querySelector('.toast-ok')?.textContent ?? '';
const alertText = (c: HTMLElement): string => c.querySelector('.banner-err')?.textContent ?? '';

/** Открыть меню строки с профилем и выбрать пункт. */
async function pick(t: Screen, row: number, label: string): Promise<void> {
  await click(t.container.querySelectorAll('.prow-more')[row]);
  const menu = t.container.querySelector<HTMLElement>('[role="menu"]');
  if (menu === null) throw new Error('меню строки не открылось');
  await click(buttonByText(menu, label));
}

describe('меню строки: новые действия', () => {
  it('содержит перенос, дублирование, разрешение доменов, сброс трафика и экспорт', async () => {
    const t = await mountServers();
    await click(t.container.querySelectorAll('.prow-more')[0]);
    const menu = t.container.querySelector<HTMLElement>('[role="menu"]');
    const labels = Array.from(menu?.querySelectorAll('[role="menuitem"]') ?? []).map((el) => el.textContent);
    for (const want of ['Move to group…', 'Duplicate', 'Resolve domain to IP', 'Reset traffic', 'Export config…']) {
      expect(labels, want).toContain(want);
    }
    t.unmount();
  });

  it('CloneProfiles: копия именно этой строки, список перечитывается, итог показан', async () => {
    const t = await mountServers();
    const clone = vi
      .spyOn(t.clients.profiles, 'cloneProfiles')
      .mockResolvedValue(create(CloneProfilesResponseSchema, { newIds: [9n] }));
    const list = vi.mocked(t.clients.profiles.listProfiles);
    const before = list.mock.calls.length;
    await pick(t, 1, 'Duplicate');
    expect(clone).toHaveBeenCalledWith({ ids: [2n] });
    expect(list.mock.calls.length).toBeGreaterThan(before);
    expect(status(t.container)).toBe('Copies created: 1');
    t.unmount();
  });

  it('ResetTraffic: сбрасывает счётчики выбранной строки', async () => {
    const t = await mountServers();
    const reset = vi.spyOn(t.clients.profiles, 'resetTraffic').mockResolvedValue({} as never);
    await pick(t, 0, 'Reset traffic');
    expect(reset).toHaveBeenCalledWith({ ids: [1n] });
    expect(status(t.container)).toBe('Traffic counters reset');
    t.unmount();
  });

  it('ResolveDomains: итог с числом разрешённых, пропущенных и неудавшихся (R)', async () => {
    const t = await mountServers();
    const resolve = vi.spyOn(t.clients.profiles, 'resolveDomains').mockResolvedValue(
      create(ResolveDomainsResponseSchema, {
        resolvedIds: [],
        skippedIds: [1n],
        failed: [create(ResolveFailureSchema, { id: 1n, reason: 'no such host' })],
      }),
    );
    await pick(t, 0, 'Resolve domain to IP');
    expect(resolve).toHaveBeenCalledWith({ ids: [1n] });
    expect(status(t.container)).toBe('Domains resolved to IP: 0; skipped: 1; failed: 1');
    t.unmount();
  });

  it('ошибка ядра попадает в баннер ошибок и не роняет экран (R)', async () => {
    const t = await mountServers();
    vi.spyOn(t.clients.profiles, 'cloneProfiles').mockRejectedValue(new Error('Failed to fetch'));
    await pick(t, 0, 'Duplicate');
    expect(alertText(t.container)).not.toBe('');
    expect(t.container.querySelector('.prow')).not.toBeNull();
    t.unmount();
  });
});

describe('MoveToGroupDialog (MoveProfiles)', () => {
  it('предлагает только обычные группы и переносит выбранный сервер', async () => {
    const t = await mountServers();
    const move = vi
      .spyOn(t.clients.profiles, 'moveProfiles')
      .mockResolvedValue({} as never);
    await pick(t, 0, 'Move to group…');
    const options = Array.from(dialog()?.querySelectorAll('option') ?? []).map((o) => o.textContent);
    expect(options).toEqual(['Default', 'Work']); // подписочной группы нет (S)
    // текущая группа сервера — Default, выбрана другая
    const select = dialog()?.querySelector<HTMLSelectElement>('select');
    expect(select?.value).toBe(String(WORK_GROUP));
    await click(buttonByText(dialog()!, 'Move'));
    expect(move).toHaveBeenCalledWith({ ids: [1n], targetGroupId: WORK_GROUP });
    expect(dialog()).toBeNull();
    expect(status(t.container)).toBe('Server moved');
    t.unmount();
  });

  it('отказ ядра остаётся в диалоге и не закрывает его (R)', async () => {
    const t = await mountServers();
    vi.spyOn(t.clients.profiles, 'moveProfiles').mockRejectedValue(new Error('Failed to fetch'));
    await pick(t, 0, 'Move to group…');
    await click(buttonByText(dialog()!, 'Move'));
    expect(dialog()?.querySelector('[role="alert"]')).not.toBeNull();
    t.unmount();
  });
});

describe('экспорт конфига (ExportConfig)', () => {
  it('сначала предупреждение «содержит секреты»; отмена ничего не запрашивает у ядра (S)', async () => {
    const t = await mountServers();
    const exportConfig = vi.spyOn(t.clients.profiles, 'exportConfig');
    await pick(t, 0, 'Export config…');
    expect(dialog()?.textContent).toMatch(/contains secrets/i);
    await click(buttonByText(dialog()!, 'Cancel'));
    expect(exportConfig).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
    t.unmount();
  });

  it('подтверждение: рабочий конфиг сохраняется через saveFile с расширением json', async () => {
    const t = await mountServers();
    const exportConfig = vi
      .spyOn(t.clients.profiles, 'exportConfig')
      .mockResolvedValue(create(ExportConfigResponseSchema, { singBoxJson: '{"log":{}}' }));
    await pick(t, 0, 'Export config…');
    await click(buttonByText(dialog()!, 'Save file…'));
    expect(exportConfig).toHaveBeenCalledWith({ profileId: 1n, purpose: ExportConfigRequest_Purpose.RUN });
    expect(saveFile).toHaveBeenCalledWith('S1', 'json', '{"log":{}}');
    expect(status(t.container)).toBe('Configuration saved');
    t.unmount();
  });

  it('пользователь закрыл системный диалог — без сообщения об успехе', async () => {
    saveFile.mockResolvedValue('cancelled');
    const t = await mountServers();
    vi.spyOn(t.clients.profiles, 'exportConfig').mockResolvedValue(create(ExportConfigResponseSchema, { singBoxJson: '{}' }));
    await pick(t, 0, 'Export config…');
    await click(buttonByText(dialog()!, 'Save file…'));
    expect(status(t.container)).toBe('');
    t.unmount();
  });
});

describe('CleanupDialog', () => {
  const open = async (t: Screen): Promise<HTMLElement> => {
    await click(buttonByText(t.container, 'Clean up…'));
    return dialog()!;
  };

  it('недоступные: пробный прогон (apply=false) → список → подтверждение (apply=true)', async () => {
    const t = await mountServers();
    const removeUnavailable = vi
      .spyOn(t.clients.profiles, 'removeUnavailableProfiles')
      .mockImplementation((req) =>
        Promise.resolve(
          create(RemoveUnavailableResponseSchema, req.apply === true
            ? { removedIds: [2n] }
            : { wouldRemoveIds: [2n], skippedIds: [1n] }),
        ),
      );
    const dlg = await open(t);
    expect(removeUnavailable).not.toHaveBeenCalled(); // само открытие ничего не делает
    await click(buttonByText(dlg, 'Check'));
    expect(removeUnavailable).toHaveBeenLastCalledWith({ groupId: DEFAULT_GROUP_ID, apply: false });
    expect(dlg.textContent).toContain('Servers to remove: 1');
    expect(dlg.textContent).toContain('S2');
    expect(dlg.textContent).toContain('Skipped: 1');
    await click(buttonByText(dlg, 'Remove 1'));
    expect(removeUnavailable).toHaveBeenLastCalledWith({ groupId: DEFAULT_GROUP_ID, apply: true });
    expect(dialog()).toBeNull();
    expect(status(t.container)).toBe('Servers removed: 1');
    t.unmount();
  });

  it('удалять нечего — кнопки подтверждения нет (E)', async () => {
    const t = await mountServers();
    vi.spyOn(t.clients.profiles, 'removeUnavailableProfiles').mockResolvedValue(create(RemoveUnavailableResponseSchema, {}));
    const dlg = await open(t);
    await click(buttonByText(dlg, 'Check'));
    expect(dlg.textContent).toContain('Nothing to remove');
    expect(Array.from(dlg.querySelectorAll('button')).some((b) => /^Remove \d/.test(b.textContent ?? ''))).toBe(false);
    t.unmount();
  });

  it('дубликаты: тот же порядок, вызывается DeduplicateProfiles', async () => {
    const t = await mountServers();
    const dedup = vi.spyOn(t.clients.profiles, 'deduplicateProfiles').mockImplementation((req) =>
      Promise.resolve(
        create(DeduplicateResponseSchema, req.apply === true ? { removedIds: [2n] } : { duplicates: [profileOf(2, 'S2')] }),
      ),
    );
    const dlg = await open(t);
    await click(buttonByText(dlg, 'Duplicates'));
    await click(buttonByText(dlg, 'Check'));
    expect(dedup).toHaveBeenLastCalledWith({ groupId: DEFAULT_GROUP_ID, apply: false });
    await click(buttonByText(dlg, 'Remove 1'));
    expect(dedup).toHaveBeenLastCalledWith({ groupId: DEFAULT_GROUP_ID, apply: true });
    t.unmount();
  });

  it('смена режима делает прежний список недействительным: подтверждать нечего (D)', async () => {
    const t = await mountServers();
    vi.spyOn(t.clients.profiles, 'removeUnavailableProfiles').mockResolvedValue(
      create(RemoveUnavailableResponseSchema, { wouldRemoveIds: [2n] }),
    );
    const dlg = await open(t);
    await click(buttonByText(dlg, 'Check'));
    expect(buttonByText(dlg, 'Remove 1')).toBeDefined();
    await click(buttonByText(dlg, 'Duplicates'));
    expect(Array.from(dlg.querySelectorAll('button')).some((b) => /^Remove \d/.test(b.textContent ?? ''))).toBe(false);
    t.unmount();
  });

  it('ошибка ядра при пробном прогоне показана, ничего не удалено (R)', async () => {
    const t = await mountServers();
    const removeUnavailable = vi
      .spyOn(t.clients.profiles, 'removeUnavailableProfiles')
      .mockRejectedValue(new Error('Failed to fetch'));
    const dlg = await open(t);
    await click(buttonByText(dlg, 'Check'));
    expect(dlg.querySelector('[role="alert"]')).not.toBeNull();
    expect(removeUnavailable).toHaveBeenCalledTimes(1);
    t.unmount();
  });
});

describe('GroupTrafficSummary', () => {
  it('показывает трафик группы за всё время, для «Все» — сумму по группам', async () => {
    const clients = makeClients({ profiles: [profileOf(1, 'S1')] });
    vi.mocked(clients.stats.getTrafficSummary).mockResolvedValue(
      create(GetTrafficSummaryResponseSchema, {
        groups: [
          create(GroupTrafficSummarySchema, { groupId: DEFAULT_GROUP_ID, uplinkBytes: 1024n, downlinkBytes: 2048n, sessionCount: 2n }),
          create(GroupTrafficSummarySchema, { groupId: 7n, uplinkBytes: 1024n, downlinkBytes: 0n, sessionCount: 1n }),
        ],
      }),
    );
    const m = await mountWithCore(clients, createElement(ServersScreen));
    await flush(30);
    const line = m.container.querySelector('#grpTraffic')?.textContent ?? '';
    expect(line).toContain('sessions: 3');
    expect(line).toMatch(/↑ 2\s*KB · ↓ 2\s*KB/);
    expect(clients.stats.getTrafficSummary).toHaveBeenCalledWith({});
    m.unmount();
  });

  it('сессий не было — строки нет (E)', async () => {
    const t = await mountServers();
    expect(t.container.querySelector('#grpTraffic')).toBeNull();
    t.unmount();
  });
});

describe('xhttp_badge (XHTTP)', () => {
  it('xhttp_badge: профиль с unsupported_reason помечен, обычный — нет', async () => {
    const t = await mountServers({ xhttp: true });
    const rows = Array.from(t.container.querySelectorAll('.prow'));
    const byName = (name: string): Element | undefined => rows.find((r) => r.textContent?.includes(name));
    expect(byName('XH')?.querySelector('.badge-warn')?.textContent).toBe('XHTTP: not supported by the core');
    expect(byName('S1')?.querySelector('.badge-warn')).toBeNull();
    t.unmount();
  });
});
