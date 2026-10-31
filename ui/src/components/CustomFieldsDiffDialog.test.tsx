// SPDX-License-Identifier: GPL-3.0-only

// CustomFieldsDiffDialog.test.tsx — T-08B: диалог подтверждения custom-полей вместе с
// хуком useCustomFieldsConfirm. Ядро подменено на уровне методов клиента; тексты — на
// английском словаре.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, createElement } from 'react';
import type { JSX } from 'react';
import { create } from '@bufbuild/protobuf';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { PreviewCustomFieldsResponseSchema, ProfileSchema } from '../gen/lavray_pb';
import type { PreviewCustomFieldsResponse, Profile } from '../gen/lavray_pb';
import { useCustomFieldsConfirm } from '../hooks/useCustomFieldsConfirm';
import type { CoreClients } from '../lib/core';
import { setLanguage, t, tf } from '../lib/i18n';
import { buttonByText, click, flush, makeClients, mountWithCore } from '../test-harness';
import type { Mounted } from '../test-harness';
import { CustomFieldsDiffDialog } from './CustomFieldsDiffDialog';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const DIFF_A = ['--- before', '+++ after', '@@ -1,3 +1,4 @@', ' {', '-  "x": 1,', '+  "x": 2,', '+  "dns": {},', ' }'].join('\n');
const DIFF_B = ['--- before', '+++ after', '@@ -1,2 +1,2 @@', ' {', '-  "y": 0', '+  "y": 9'].join('\n');
const NAME = 'My <b>node</b>';

type PreviewInit = MessageInitShape<typeof PreviewCustomFieldsResponseSchema>;
const preview = (extra: PreviewInit = {}): PreviewCustomFieldsResponse =>
  create(PreviewCustomFieldsResponseSchema, { customHash: HASH_A, diff: DIFF_A, touchedKeys: ['dns'], ...extra });

interface Rig {
  readonly previewSpy: MockInstance<CoreClients['profiles']['previewCustomFields']>;
  readonly confirmSpy: MockInstance<CoreClients['profiles']['confirmCustomFields']>;
  readonly onConfirmed: ReturnType<typeof vi.fn>;
  readonly onClosed: ReturnType<typeof vi.fn>;
  readonly mounted: Mounted;
}

function Host(props: { readonly onConfirmed: (p: Profile) => void; readonly onClosed: () => void }): JSX.Element {
  const cf = useCustomFieldsConfirm(props);
  return (
    <>
      <button
        id="opener"
        onClick={() => {
          cf.open(7n, NAME);
        }}
      >
        open
      </button>
      {cf.dialogProps !== null && <CustomFieldsDiffDialog {...cf.dialogProps} />}
    </>
  );
}

const dialog = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[role="dialog"]');
  if (el === null) throw new Error('диалог не открыт');
  return el;
};
const checkbox = (): HTMLInputElement => {
  const el = dialog().querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (el === null) throw new Error('нет флажка согласия');
  return el;
};
const applyBtn = (): HTMLButtonElement => buttonByText(dialog(), t('cf.apply'));
const text = (): string => dialog().textContent ?? '';
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function press(key: string, shiftKey = false): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  act(() => {
    document.dispatchEvent(ev);
  });
  return ev;
}

describe('CustomFieldsDiffDialog (T-08B)', () => {
  let mounted: Mounted | undefined;

  beforeEach(() => {
    setLanguage('en');
    window.localStorage.clear();
  });
  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  /** Монтирует хост, подменяет ядро и открывает диалог кнопкой. */
  async function start(
    previews: readonly (PreviewCustomFieldsResponse | Error)[],
    confirms: readonly (Profile | Error)[] = [],
  ): Promise<Rig> {
    const clients = makeClients();
    const previewSpy = vi.spyOn(clients.profiles, 'previewCustomFields');
    for (const p of previews) {
      if (p instanceof Error) previewSpy.mockRejectedValueOnce(p);
      else previewSpy.mockResolvedValueOnce(p);
    }
    const confirmSpy = vi.spyOn(clients.profiles, 'confirmCustomFields');
    for (const c of confirms) {
      if (c instanceof Error) confirmSpy.mockRejectedValueOnce(c);
      else confirmSpy.mockResolvedValueOnce(c);
    }
    const onConfirmed = vi.fn();
    const onClosed = vi.fn();
    mounted = await mountWithCore(clients, createElement(Host, { onConfirmed, onClosed }));
    const opener = document.getElementById('opener');
    act(() => {
      opener?.focus();
    });
    await click(opener);
    await flush(10);
    return { previewSpy, confirmSpy, onConfirmed, onClosed, mounted };
  }

  const confirmed = (): Profile => create(ProfileSchema, { id: 7n, name: 'My node', customFieldsConfirmed: true });

  it('confirm_button_disabled_until_checkbox: «Применить» активна только после флажка', async () => {
    await start([preview()]);
    expect(checkbox().checked).toBe(false);
    expect(applyBtn().disabled).toBe(true);
    await click(checkbox());
    expect(checkbox().checked).toBe(true);
    expect(applyBtn().disabled).toBe(false);
    await click(checkbox());
    expect(applyBtn().disabled).toBe(true);
  });

  it('confirm_calls_confirmCustomFields_with_hash: уходит хэш просмотренного превью, диалог закрывается', async () => {
    const rig = await start([preview()], [confirmed()]);
    expect(rig.previewSpy).toHaveBeenCalledWith({ profileId: 7n });
    await click(checkbox());
    await click(applyBtn());
    expect(rig.confirmSpy).toHaveBeenCalledTimes(1);
    expect(rig.confirmSpy.mock.calls[0]?.[0]).toEqual({ profileId: 7n, customHash: HASH_A });
    expect(rig.onConfirmed).toHaveBeenCalledTimes(1);
    expect((rig.onConfirmed.mock.calls[0]?.[0] as Profile).customFieldsConfirmed).toBe(true);
    expect(rig.onClosed).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('stale_hash_reloads_preview: FAILED_PRECONDITION — новое превью, флажок снят, сообщение «содержимое изменилось»', async () => {
    const rig = await start(
      [preview(), preview({ customHash: HASH_B, diff: DIFF_B })],
      [new ConnectError('custom content changed', Code.FailedPrecondition), confirmed()],
    );
    expect(text()).not.toContain(t('cf.changed'));
    await click(checkbox());
    await click(applyBtn());

    expect(rig.previewSpy).toHaveBeenCalledTimes(2);
    expect(rig.onClosed).not.toHaveBeenCalled();
    expect(checkbox().checked).toBe(false);
    expect(applyBtn().disabled).toBe(true);
    expect(text()).toContain(t('cf.changed'));
    expect(text()).toContain('"y": 9'); // показан новый diff, а не старый
    expect(text()).not.toContain('"x": 2');

    await click(checkbox());
    await click(applyBtn());
    expect(rig.confirmSpy).toHaveBeenCalledTimes(2);
    expect(rig.confirmSpy.mock.calls[1]?.[0]).toEqual({ profileId: 7n, customHash: HASH_B });
    expect(rig.onConfirmed).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('escape_closes_without_confirm: Esc и «Cancel» закрывают, ничего не подтверждая', async () => {
    const rig = await start([preview()]);
    await click(checkbox());
    expect(press('Escape').defaultPrevented).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(rig.confirmSpy).not.toHaveBeenCalled();
    expect(rig.onConfirmed).not.toHaveBeenCalled();
    expect(rig.onClosed).toHaveBeenCalledTimes(1);

    await click(document.getElementById('opener'));
    await click(buttonByText(dialog(), t('common.cancel')));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(rig.confirmSpy).not.toHaveBeenCalled();
    expect(rig.onClosed).toHaveBeenCalledTimes(2);
  });

  it('dialog_has_label_and_focus_trap: имя через aria-labelledby, фокус внутри, Tab не уходит наружу', async () => {
    await start([preview()]);
    const dlg = dialog();
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const heading = document.getElementById(dlg.getAttribute('aria-labelledby') ?? '');
    expect(heading?.textContent).toBe(t('cf.title'));
    expect(dlg.contains(document.activeElement)).toBe(true);

    const items = Array.from(dlg.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    expect(items.length).toBeGreaterThanOrEqual(4); // «×», область diff, флажок, «Отмена»
    act(() => {
      last?.focus();
    });
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(press('Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('при закрытии фокус возвращается на кнопку-открывалку', async () => {
    await start([preview()]);
    press('Escape');
    expect(document.activeElement).toBe(document.getElementById('opener'));
  });

  it('empty_diff_shows_no_changes: пустой diff — текст «не меняют», области diff нет, подтвердить можно', async () => {
    await start([preview({ diff: '', touchedKeys: [] })]);
    expect(text()).toContain(t('cf.diffEmpty'));
    expect(dialog().querySelector('[role="region"]')).toBeNull();
    await click(checkbox());
    expect(applyBtn().disabled).toBe(false);
  });

  it('warnings_rendered: internal_full и inbounds_changed — тексты из словаря, незнакомый код — как есть', async () => {
    await start([preview({ warnings: ['internal_full', 'inbounds_changed', 'weird_code'] })]);
    const banners = Array.from(dialog().querySelectorAll('.banner-warn')).map((b) => (b.textContent ?? '').trim());
    expect(banners).toEqual([
      t('cf.warn.internal_full'),
      t('cf.warn.inbounds_changed'),
      tf('cf.warn.other', { code: 'weird_code' }),
    ]);
  });

  it('показывает имя профиля текстом, затронутые ключи и diff с подписью области', async () => {
    await start([preview({ touchedKeys: ['dns.servers', 'outbounds[0].tls'] })]);
    const forProfile = dialog().querySelector('.cf-for');
    expect(forProfile?.textContent).toBe(tf('cf.forProfile', { name: NAME }));
    expect(forProfile?.querySelector('b')).toBeNull(); // имя — текст, не разметка
    expect(Array.from(dialog().querySelectorAll('.cf-keys li')).map((li) => li.textContent)).toEqual([
      'dns.servers',
      'outbounds[0].tls',
    ]);
    expect(dialog().querySelector('[role="region"]')?.getAttribute('aria-label')).toBe(t('cf.diffLabel'));
  });

  it('truncated_note: заметка об обрезанном diff и о том, что содержимое уже подтверждено', async () => {
    await start([preview({ diffTruncated: true, alreadyConfirmed: true })]);
    expect(text()).toContain(t('cf.truncated'));
    expect(text()).toContain(t('cf.already'));
  });

  it('truncated_note: без флагов заметок нет', async () => {
    await start([preview()]);
    expect(text()).not.toContain(t('cf.truncated'));
    expect(text()).not.toContain(t('cf.already'));
  });

  it('other_error_shown: прочая ошибка подтверждения — в баннере, диалог остаётся, повторить можно', async () => {
    const rig = await start([preview()], [new ConnectError('disk is full', Code.Internal), confirmed()]);
    await click(checkbox());
    await click(applyBtn());
    expect(dialog().querySelector('.banner-err')?.textContent).toContain('disk is full');
    expect(rig.previewSpy).toHaveBeenCalledTimes(1); // не FAILED_PRECONDITION: превью не перезагружается
    expect(rig.onClosed).not.toHaveBeenCalled();
    expect(checkbox().checked).toBe(true);
    expect(applyBtn().disabled).toBe(false);

    await click(applyBtn());
    expect(rig.onConfirmed).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('other_error_shown: ошибка загрузки превью — баннер без флажка, «Применить» недоступна', async () => {
    const rig = await start([new ConnectError('profile 7 not found', Code.NotFound)]);
    expect(dialog().querySelector('.banner-err')?.textContent).toContain('profile 7 not found');
    expect(dialog().querySelector('input[type="checkbox"]')).toBeNull();
    expect(applyBtn().disabled).toBe(true);
    await click(buttonByText(dialog(), t('common.cancel')));
    expect(rig.confirmSpy).not.toHaveBeenCalled();
    expect(rig.onClosed).toHaveBeenCalledTimes(1);
  });

  it('пока превью грузится: статус «Loading…», флажка и применения нет', async () => {
    const clients = makeClients();
    vi.spyOn(clients.profiles, 'previewCustomFields').mockReturnValue(new Promise(() => undefined));
    mounted = await mountWithCore(clients, createElement(Host, { onConfirmed: vi.fn(), onClosed: vi.fn() }));
    await click(document.getElementById('opener'));
    expect(dialog().querySelector('[role="status"]')?.textContent).toBe(t('cf.loading'));
    expect(dialog().querySelector('input[type="checkbox"]')).toBeNull();
    expect(applyBtn().disabled).toBe(true);
  });
});
