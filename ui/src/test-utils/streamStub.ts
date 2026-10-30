// SPDX-License-Identifier: GPL-3.0-only

// streamStub.ts — ответы server-stream RPC Connect для тестов UI. Тело ответа —
// поток кадров `application/connect+json`: 5 байт заголовка (флаги, длина
// big-endian) и JSON. Кадры сообщений идут с флагом 0, в конце — кадр
// end-stream (флаг 0x02) с `{}` либо `{"error":{"code","message"}}`, как у ядра.
// Подключается через coreStub (маршрут «Сервис/Метод» → StreamReply); сам fetch
// не подменяет.

const HEADER_BYTES = 5;
const FLAG_END_STREAM = 0b10;

/** Content-Type ответа и запроса server-stream в JSON-режиме Connect. */
export const CONNECT_STREAM_TYPE = 'application/connect+json';

/** Ошибка в кадре end-stream; code — строка Connect (`unavailable`, `not_found`, …). */
export interface StreamEnd {
  readonly code: string;
  readonly message?: string;
}

export interface StreamOptions {
  /** Закрыть поток ошибкой в end-stream. Без неё поток кончается чисто (`{}`). */
  readonly error?: StreamEnd;
  /** Не закрывать поток после кадров: долгая подписка, которую обрывает только abort. */
  readonly hold?: boolean;
}

/** Ответ на server-stream RPC: сообщения в виде protojson (как отдаёт ядро), затем конец. */
export class StreamReply {
  constructor(
    readonly frames: readonly unknown[],
    readonly options: StreamOptions = {},
  ) {}
}

/** Кадр конверта Connect: флаги, длина (4 байта, big-endian), JSON. */
export function encodeFrame(flags: number, payload: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const out = new Uint8Array(HEADER_BYTES + body.length);
  out[0] = flags;
  new DataView(out.buffer).setUint32(1, body.length);
  out.set(body, HEADER_BYTES);
  return out;
}

/**
 * Тело запроса Connect как JSON. У server-stream запрос тоже в конверте
 * (`application/connect+json`): берём данные первого кадра.
 */
export function decodeConnectBody(body: Uint8Array | string, contentType: string | null): unknown {
  if (typeof body === 'string') return JSON.parse(body) as unknown;
  const enveloped = contentType?.startsWith(CONNECT_STREAM_TYPE) === true;
  const json = enveloped ? body.subarray(HEADER_BYTES) : body;
  return JSON.parse(new TextDecoder().decode(json)) as unknown;
}

function endPayload(error: StreamEnd | undefined): unknown {
  return error === undefined ? {} : { error: { code: error.code, message: error.message ?? '' } };
}

/** Что fetch отдаёт при abort: Error с именем AbortError (connect превращает его в Canceled). */
function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * Тело ответа-стрима. Кадры отдаются по одному на каждое чтение (как с сети),
 * поэтому abort между чтениями обрывает остаток. abort вызывает ошибку чтения.
 */
export function streamResponse(reply: StreamReply, signal?: AbortSignal | null): Response {
  const { frames, options } = reply;
  let next = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller): void {
      if (!signal) return;
      signal.addEventListener(
        'abort',
        () => {
          controller.error(abortError(signal));
        },
        { once: true },
      );
    },
    pull(controller): Promise<void> {
      const frame = frames[next];
      if (next < frames.length) {
        next += 1;
        controller.enqueue(encodeFrame(0, frame));
      } else if (options.hold === true) {
        return new Promise<void>(() => undefined); // ждём abort
      } else {
        controller.enqueue(encodeFrame(FLAG_END_STREAM, endPayload(options.error)));
        controller.close();
      }
      return Promise.resolve();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': CONNECT_STREAM_TYPE } });
}

/** Ответ fetch на вызов стрима: уже оборванный signal отклоняет вызов, как настоящий fetch. */
export function streamFetch(reply: StreamReply, signal?: AbortSignal | null): Promise<Response> {
  if (signal?.aborted === true) return Promise.reject(abortError(signal));
  return Promise.resolve(streamResponse(reply, signal));
}
