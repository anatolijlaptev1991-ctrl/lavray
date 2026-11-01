// SPDX-License-Identifier: GPL-3.0-only

// coreError.ts — ошибки ядра для тестов: код Connect и причина в детали
// google.rpc.ErrorInfo { domain: "lavray.core", reason }, как их отдаёт ядро.
import { ConnectError, type Code } from '@connectrpc/connect';

const enc = new TextEncoder();

/** google.rpc.ErrorInfo в проволочном формате: reason = 1, domain = 2, metadata = 3. */
export function errorInfoBytes(reason: string, domain = `lavray.core`): Uint8Array {
  const r = enc.encode(reason);
  const d = enc.encode(domain);
  const meta = enc.encode('k\u0012\u0001v'); // лишнее поле: разбор его пропускает
  return Uint8Array.from([0x0a, r.length, ...r, 0x12, d.length, ...d, 0x1a, meta.length, ...meta]);
}

/** Ошибка ядра; reason = null — деталей нет. */
export function coreError(code: Code, reason: string | null, domain = `lavray.core`): ConnectError {
  const e = new ConnectError('сообщение ядра', code);
  if (reason !== null) e.details = [{ type: 'google.rpc.ErrorInfo', value: errorInfoBytes(reason, domain) }];
  return e;
}
