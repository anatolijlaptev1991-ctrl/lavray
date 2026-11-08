// SPDX-License-Identifier: GPL-3.0-only

// compat.ts — настоящий клиент UI (connect-web createConnectTransport, JSON-кодек,
// перехватчики авторизации из ui/src/lib/coreAuth.ts, сгенерированные сервисы
// ui/src/gen) вызывает сервер и возвращает наблюдаемые результаты. Собирается
// esbuild в run-compat.mjs; запускать напрямую не нужно.
import { createConnectTransport } from '@connectrpc/connect-web';
import { Code, ConnectError, createClient } from '@connectrpc/connect';
import { CoreService, ProfileService } from '../../../ui/src/gen/lavray_pb';
import { authInterceptors } from '../../../ui/src/lib/coreAuth';

type Json = Record<string, unknown>;

// bigint -> строка, undefined опускается: форма, пригодная для сравнения.
const plain = (m: unknown): Json =>
  JSON.parse(JSON.stringify(m, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) as Json;

const errOf = (e: unknown): Json =>
  e instanceof ConnectError ? { code: Code[e.code], rawMessage: e.rawMessage } : { other: String(e) };

async function attempt(f: () => Promise<unknown>): Promise<Json> {
  try {
    return { ok: plain(await f()) };
  } catch (e) {
    return { err: errOf(e) };
  }
}

/** События потока: первые `n` (или все, если n=0), затем отмена. */
async function events(core: ReturnType<typeof clientOf>['core'], req: Json, n: number): Promise<Json> {
  const ac = new AbortController();
  const got: Json[] = [];
  try {
    for await (const ev of core.subscribeEvents(req, { signal: ac.signal })) {
      got.push(plain(ev));
      if (n > 0 && got.length >= n) {
        ac.abort();
        break;
      }
    }
    return { events: got, endedCleanly: true };
  } catch (e) {
    return { events: got, err: errOf(e) };
  }
}

function clientOf(baseUrl: string, token?: string) {
  const transport = createConnectTransport({
    baseUrl,
    useBinaryFormat: false,
    interceptors: authInterceptors(token ? { token } : undefined),
  });
  return { core: createClient(CoreService, transport), profiles: createClient(ProfileService, transport) };
}

/** Набор вызовов, общий для Go и Rust; `extra` — проверки Rust-спайка (burst/error). */
export async function collect(baseUrl: string, token: string, extra: boolean): Promise<Json> {
  const { core, profiles } = clientOf(baseUrl, token);
  const anon = clientOf(baseUrl);
  const bad = clientOf(baseUrl, 'wrong-token');
  const out: Json = {
    getStatus: await attempt(() => core.getStatus({})),
    stopTests: await attempt(() => profiles.stopTests({})),
    streamFirstEvent: await events(core, {}, 1),
    getStatusNoToken: await attempt(() => anon.core.getStatus({})),
    getStatusWrongToken: await attempt(() => bad.core.getStatus({})),
    streamNoToken: await events(anon.core, {}, 1),
  };
  if (extra) {
    out.streamBurst = await events(core, { eventKinds: ['spike_burst'] }, 0);
    out.streamError = await events(core, { eventKinds: ['spike_error'] }, 0);
  }
  return out;
}
