// SPDX-License-Identifier: GPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreState } from '../gen/lavray_pb';
import { deDict } from './dictionaries/de';
import { enDict } from './dictionaries/en';
import { esDict } from './dictionaries/es';
import { ruDict } from './dictionaries/ru';
import { zhDict } from './dictionaries/zh';
import { notifyKindFor, notifyText, showNotification, windowIsAway, type NotifyKind } from './notify';

vi.mock('@tauri-apps/api/core', async () => (await import('../test-utils/tauriStub')).tauriCoreModule);
const { tauri, enableTauri, disableTauri } = await import('../test-utils/tauriStub');

beforeEach(() => {
  tauri.reset();
  enableTauri();
});

afterEach(() => {
  disableTauri();
});

describe('notifyKindFor', () => {
  it('first_observation_is_silent', () => {
    expect(notifyKindFor(null, CoreState.CONNECTED)).toBeNull();
    expect(notifyKindFor(null, CoreState.ERROR)).toBeNull();
  });

  it('transitions', () => {
    expect(notifyKindFor(CoreState.CONNECTING, CoreState.CONNECTED)).toBe('connected');
    expect(notifyKindFor(CoreState.RECONNECTING, CoreState.CONNECTED)).toBe('connected');
    expect(notifyKindFor(CoreState.CONNECTED, CoreState.IDLE)).toBe('disconnected');
    expect(notifyKindFor(CoreState.DISCONNECTING, CoreState.IDLE)).toBe('disconnected');
    expect(notifyKindFor(CoreState.CONNECTED, CoreState.ERROR)).toBe('error');
    expect(notifyKindFor(CoreState.CONNECTING, CoreState.ERROR)).toBe('error');
  });

  it('quiet_transitions', () => {
    expect(notifyKindFor(CoreState.CONNECTED, CoreState.CONNECTED)).toBeNull();
    expect(notifyKindFor(CoreState.IDLE, CoreState.CONNECTING)).toBeNull();
    expect(notifyKindFor(CoreState.CONNECTED, CoreState.RECONNECTING)).toBeNull();
    expect(notifyKindFor(CoreState.ERROR, CoreState.IDLE)).toBeNull();
    expect(notifyKindFor(CoreState.CONNECTING, CoreState.IDLE)).toBeNull();
  });
});

describe('notifyText', () => {
  it('notification_has_no_server_name_or_placeholders', () => {
    for (const dict of [ruDict, enDict, deDict, esDict, zhDict]) {
      for (const kind of ['connected', 'disconnected', 'error'] as NotifyKind[]) {
        const { title, body } = notifyText(kind, (k) => (dict as Record<string, string>)[k] ?? k);
        expect(title).toBe('LAVRay');
        expect(body).not.toMatch(/^notify\./);
        expect(body).not.toMatch(/\{|\}/);
      }
    }
  });
});

describe('windowIsAway', () => {
  it('hidden_or_unfocused', () => {
    const doc = (hidden: boolean, focus: boolean): Document =>
      ({ hidden, hasFocus: () => focus }) as unknown as Document;
    expect(windowIsAway(doc(true, true))).toBe(true);
    expect(windowIsAway(doc(false, false))).toBe(true);
    expect(windowIsAway(doc(false, true))).toBe(false);
  });
});

describe('showNotification', () => {
  it('invokes_shell_with_kind_and_texts', async () => {
    tauri.onValue('notify_show', true);
    await expect(showNotification('connected', 'LAVRay', 'ok')).resolves.toBe(true);
    expect(tauri.argsOf('notify_show')).toEqual([{ kind: 'connected', title: 'LAVRay', body: 'ok' }]);
  });

  it('suppressed_or_failed_is_false', async () => {
    tauri.onValue('notify_show', false);
    await expect(showNotification('error', 't', 'b')).resolves.toBe(false);
    tauri.onError('notify_show', 'unknown_kind');
    await expect(showNotification('error', 't', 'b')).resolves.toBe(false);
  });

  it('outside_shell_does_nothing', async () => {
    disableTauri();
    await expect(showNotification('error', 't', 'b')).resolves.toBe(false);
    expect(tauri.calls).toEqual([]);
  });
});
