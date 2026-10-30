// SPDX-License-Identifier: GPL-3.0-only

// streamStub.test.ts — server-stream ответы Connect через настоящий клиент
// createCoreClients: порядок кадров, ошибка end-stream, abort.
import { Code, ConnectError } from '@connectrpc/connect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoreClients } from '../lib/core';
import { stubCore } from './coreStub';
import { decodeConnectBody, encodeFrame, StreamReply, streamResponse } from './streamStub';

afterEach(() => {
  vi.unstubAllGlobals();
});

const line = (n: number): Record<string, unknown> => ({
  tsMs: String(n),
  level: 'LOG_LEVEL_INFO',
  source: 'core',
  message: `строка ${String(n)}`,
});

/** Ошибка, которой завершился перебор стрима (или undefined, если он кончился чисто). */
async function failureOf(iterable: AsyncIterable<unknown>): Promise<unknown> {
  try {
    for await (const _ of iterable) {
      // кадры нужны только для того, чтобы дойти до конца
    }
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('streamStub', () => {
  it('кадры приходят по порядку и разобраны настоящим клиентом (H)', async () => {
    const stub = stubCore({ 'LogService/Subscribe': new StreamReply([line(1), line(2), line(3)]) });
    const clients = createCoreClients('http://127.0.0.1:1');

    const got: string[] = [];
    for await (const m of clients.logs.subscribe({ tailLines: 10 })) got.push(`${String(m.tsMs)}:${m.message}`);

    expect(got).toEqual(['1:строка 1', '2:строка 2', '3:строка 3']);
    // Запрос стрима лежит в конверте; заглушка достаёт из него JSON.
    expect(stub.bodies('LogService/Subscribe')).toEqual([{ tailLines: 10 }]);
  });

  it('int64 и вложенные сообщения доходят как у ядра: StatsService/Subscribe (H)', async () => {
    stubCore({
      'StatsService/Subscribe': new StreamReply([
        { tsMs: '5', tags: [{ tag: 'proxy', uplinkBps: 1.5, downlinkBps: 2, uplinkTotal: '10', downlinkTotal: '20' }] },
        { tsMs: '6', final: true },
      ]),
    });
    const clients = createCoreClients('http://127.0.0.1:1');

    const frames = [];
    for await (const m of clients.stats.subscribe({ intervalMs: 1000 })) frames.push(m);

    expect(frames.map((f) => f.tsMs)).toEqual([5n, 6n]);
    expect(frames[0]?.tags[0]).toMatchObject({ tag: 'proxy', uplinkTotal: 10n, downlinkTotal: 20n });
    expect(frames[1]?.final).toBe(true);
  });

  it('пустой стрим кончается чисто (E)', async () => {
    stubCore({ 'LogService/Subscribe': new StreamReply([]) });
    const clients = createCoreClients('http://127.0.0.1:1');
    expect(await failureOf(clients.logs.subscribe({}))).toBeUndefined();
  });

  it('end-stream с ошибкой даёт ConnectError с этим кодом, кадры до него доставлены (I)', async () => {
    stubCore({
      'LogService/Subscribe': new StreamReply([line(1)], {
        error: { code: 'unavailable', message: 'ядро останавливается' },
      }),
    });
    const clients = createCoreClients('http://127.0.0.1:1');

    const got: string[] = [];
    let failure: unknown;
    try {
      for await (const m of clients.logs.subscribe({})) got.push(m.message);
    } catch (e) {
      failure = e;
    }

    expect(got).toEqual(['строка 1']);
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.Unavailable);
    expect((failure as ConnectError).rawMessage).toBe('ядро останавливается');
  });

  it('abort останавливает стрим: остальные кадры не приходят (X)', async () => {
    stubCore({ 'LogService/Subscribe': new StreamReply([line(1), line(2), line(3)], { hold: true }) });
    const clients = createCoreClients('http://127.0.0.1:1');
    const abort = new AbortController();

    const got: string[] = [];
    let failure: unknown;
    try {
      for await (const m of clients.logs.subscribe({}, { signal: abort.signal })) {
        got.push(m.message);
        if (got.length === 2) abort.abort();
      }
    } catch (e) {
      failure = e;
    }

    expect(got).toEqual(['строка 1', 'строка 2']);
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.Canceled);
  });

  it('abort до начала стрима отклоняет вызов без кадров (X)', async () => {
    stubCore({ 'LogService/Subscribe': new StreamReply([line(1)]) });
    const clients = createCoreClients('http://127.0.0.1:1');
    const abort = new AbortController();
    abort.abort();

    const got: string[] = [];
    let failure: unknown;
    try {
      for await (const m of clients.logs.subscribe({}, { signal: abort.signal })) got.push(m.message);
    } catch (e) {
      failure = e;
    }

    expect(got).toEqual([]);
    expect((failure as ConnectError).code).toBe(Code.Canceled);
  });

  it('маршрут-функция отдаёт разный ответ на каждый вызов (D)', async () => {
    stubCore({
      'LogService/Subscribe': (call): StreamReply =>
        call === 0
          ? new StreamReply([line(1)], { error: { code: 'internal', message: 'сбой' } })
          : new StreamReply([line(2)]),
    });
    const clients = createCoreClients('http://127.0.0.1:1');

    const first = await failureOf(clients.logs.subscribe({}));
    expect((first as ConnectError).code).toBe(Code.Internal);
    const second: string[] = [];
    for await (const m of clients.logs.subscribe({})) second.push(m.message);
    expect(second).toEqual(['строка 2']);
  });
});

describe('streamResponse', () => {
  it('abort рвёт чтение тела ошибкой AbortError и сбрасывает буфер (X)', async () => {
    const abort = new AbortController();
    const res = streamResponse(new StreamReply([line(1), line(2)], { hold: true }), abort.signal);
    expect(res.headers.get('Content-Type')).toBe('application/connect+json');
    const reader = res.body!.getReader();

    expect((await reader.read()).done).toBe(false);
    abort.abort();

    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('encodeFrame / decodeConnectBody', () => {
  it('заголовок: флаги и длина big-endian, затем JSON (B)', () => {
    const frame = encodeFrame(0b10, { a: 'б' });
    const json = '{"a":"б"}';
    const bytes = new TextEncoder().encode(json).length;
    expect(Array.from(frame.subarray(0, 5))).toEqual([2, 0, 0, 0, bytes]);
    expect(new TextDecoder().decode(frame.subarray(5))).toBe(json);
  });

  it('запрос в конверте и обычный JSON-запрос читаются одинаково (I)', () => {
    const enveloped = encodeFrame(0, { tailLines: 3 });
    expect(decodeConnectBody(enveloped, 'application/connect+json')).toEqual({ tailLines: 3 });
    expect(decodeConnectBody('{"tailLines":3}', 'application/json')).toEqual({ tailLines: 3 });
  });
});
