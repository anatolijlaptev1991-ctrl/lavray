// SPDX-License-Identifier: GPL-3.0-only

import { beforeEach, describe, expect, it } from 'vitest';
import {
  PENDING_CONNECT_KEY,
  PENDING_CONNECT_TTL_MS,
  clearPendingConnect,
  savePendingConnect,
  takePendingConnect,
} from './pendingConnect';
import { UI_STATE_KEYS } from './uiState';

const NOW = 1_700_000_000_000;

describe('pendingConnect', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('читается один раз и удаляется', () => {
    savePendingConnect(window.localStorage, { profileId: 7n, mode: 'tun', ts: NOW });
    expect(takePendingConnect(window.localStorage, NOW + 1000)).toEqual({ profileId: 7n, mode: 'tun', ts: NOW });
    expect(window.localStorage.getItem(PENDING_CONNECT_KEY)).toBeNull();
    expect(takePendingConnect(window.localStorage, NOW + 1000)).toBeNull();
  });

  it('старше двух минут не исполняется, но тоже удаляется', () => {
    savePendingConnect(window.localStorage, { profileId: 7n, mode: 'tun', ts: NOW });
    expect(takePendingConnect(window.localStorage, NOW + PENDING_CONNECT_TTL_MS + 1)).toBeNull();
    expect(window.localStorage.getItem(PENDING_CONNECT_KEY)).toBeNull();
  });

  it('ровно на границе срока ещё действует; «из будущего» — нет', () => {
    savePendingConnect(window.localStorage, { profileId: 7n, mode: 'system_proxy', ts: NOW });
    expect(takePendingConnect(window.localStorage, NOW + PENDING_CONNECT_TTL_MS)).not.toBeNull();
    savePendingConnect(window.localStorage, { profileId: 7n, mode: 'tun', ts: NOW });
    expect(takePendingConnect(window.localStorage, NOW - 5)).toBeNull();
  });

  it.each([
    '',
    '{',
    'null',
    '[]',
    '{"profileId":"0","mode":"tun","ts":1}',
    '{"profileId":"5","mode":"x","ts":1}',
    '{"profileId":5,"mode":"tun","ts":1}',
    '{"profileId":"5","mode":"tun"}',
  ])('испорченное значение %j игнорируется и удаляется', (raw) => {
    window.localStorage.setItem(PENDING_CONNECT_KEY, raw);
    expect(takePendingConnect(window.localStorage, NOW)).toBeNull();
    expect(window.localStorage.getItem(PENDING_CONNECT_KEY)).toBeNull();
  });

  it('clear снимает намерение; ключ входит в общий список ui-state', () => {
    savePendingConnect(window.localStorage, { profileId: 7n, mode: 'tun', ts: NOW });
    clearPendingConnect(window.localStorage);
    expect(takePendingConnect(window.localStorage, NOW)).toBeNull();
    expect(UI_STATE_KEYS).toContain(PENDING_CONNECT_KEY);
  });
});
