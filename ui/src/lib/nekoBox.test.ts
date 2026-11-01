// SPDX-License-Identifier: GPL-3.0-only

// nekoBox.test.ts — строки с числами и перевод ошибок переноса из NekoBox (T-78).
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { describe, expect, it } from 'vitest';
import { NekoBoxCandidateSchema, NekoBoxReportSchema } from '../gen/lavray_pb';
import { countsLine, foundText, nekoBoxErrorText, profilesTotal, reportText } from './nekoBox';
import { LANGUAGES, t, type MessageKey } from './i18n';

const tr = (key: MessageKey): string => t(key, 'en');

describe('nekoBox (T-78)', () => {
  it('склоняет числа по языку: ru — 1 сервер, 2 сервера, 5 серверов', () => {
    expect(countsLine(1, 1, 1, 'ru')).toBe('1 сервер, 1 группа, 1 маршрут');
    expect(countsLine(2, 2, 2, 'ru')).toBe('2 сервера, 2 группы, 2 маршрута');
    expect(countsLine(5, 5, 5, 'ru')).toBe('5 серверов, 5 групп, 5 маршрутов');
    expect(countsLine(1, 2, 0, 'en')).toBe('1 server, 2 groups, 0 routes');
  });

  it('«Найдено» и «Перенесено» подставляют числа на всех языках, скобок не остаётся', () => {
    const cand = create(NekoBoxCandidateSchema, { path: 'C:/n', groups: 2, profiles: 32, routes: 3 });
    const report = create(NekoBoxReportSchema, { groupsImported: 2, profilesByType: { vless: 30, trojan: 2 }, routesImported: 3 });
    expect(profilesTotal(report)).toBe(32);
    for (const lang of LANGUAGES) {
      for (const text of [foundText(cand, lang), reportText(report, lang)]) {
        expect(text, lang).not.toMatch(/\{\w+\}/);
        expect(text, lang).toMatch(/32/);
      }
    }
  });

  it('коды Connect → тексты; недоступное ядро и прочее различаются', () => {
    const cases: [Code, string][] = [
      [Code.InvalidArgument, tr('nb.err.invalid')],
      [Code.NotFound, tr('nb.err.notFound')],
      [Code.ResourceExhausted, tr('nb.err.limits')],
      [Code.Aborted, tr('nb.err.busy')],
      [Code.Internal, tr('nb.err.generic')],
    ];
    for (const [code, text] of cases) expect(nekoBoxErrorText(new ConnectError('x', code), tr), String(code)).toBe(text);
    expect(nekoBoxErrorText(new TypeError('Failed to fetch'), tr)).toBe(tr('core.unavailable'));
    expect(nekoBoxErrorText(new Error('boom'), tr)).toBe(tr('nb.err.generic'));
  });
});
