// SPDX-License-Identifier: GPL-3.0-only

// bench-lib.mjs — клиент замера: keep-alive HTTP/1.1 на loopback и статистика.
// Клиент один и тот же для обоих серверов, поэтому его накладные расходы
// (порядка десятков микросекунд на запрос в Node) входят в обе цифры одинаково.
import http from 'node:http';

export const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });

const us = (t0) => Number(process.hrtime.bigint() - t0) / 1000;

/** Один unary-вызов; возвращает задержку в мкс. Тело ответа читается целиком. */
export function unary(base, path, token) {
  return new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint();
    const req = http.request(
      base + path,
      {
        method: 'POST',
        agent,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': 2 },
      },
      (res) => {
        res.resume();
        res.on('end', () => (res.statusCode === 200 ? resolve(us(t0)) : reject(new Error('status ' + res.statusCode))));
      },
    );
    req.on('error', reject);
    req.end('{}');
  });
}

/** Время от отправки запроса до целого первого кадра SubscribeEvents; поток закрывается. */
export function firstFrame(base, token) {
  return new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint();
    const body = Buffer.from([0, 0, 0, 0, 2, 0x7b, 0x7d]);
    const req = http.request(
      base + '/lavray.v1.CoreService/SubscribeEvents',
      { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/connect+json', 'content-length': body.length } },
      (res) => {
        let have = Buffer.alloc(0);
        res.on('data', (c) => {
          have = Buffer.concat([have, c]);
          if (have.length >= 5 && have.length >= 5 + have.readUInt32BE(1)) {
            const t = us(t0);
            req.destroy();
            resolve(t);
          }
        });
        res.on('error', () => {});
      },
    );
    req.on('error', (e) => (e.code === 'ECONNRESET' ? null : reject(e)));
    req.end(body);
  });
}

export async function sequential(n, call) {
  const lat = new Array(n);
  for (let i = 0; i < n; i++) lat[i] = await call();
  return lat;
}

/** `workers` одновременных циклов по `per` вызовов; возвращает задержки и общий rps. */
export async function parallel(workers, per, call) {
  const t0 = process.hrtime.bigint();
  const parts = await Promise.all(Array.from({ length: workers }, () => sequential(per, call)));
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  return { lat: parts.flat(), rps: (workers * per) / secs };
}

export function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export function summarize(lat) {
  const s = [...lat].sort((a, b) => a - b);
  return { p50: pct(s, 50), p99: pct(s, 99), mean: s.reduce((a, b) => a + b, 0) / s.length, max: s[s.length - 1] };
}

export const median = (xs) => pct([...xs].sort((a, b) => a - b), 50);
export function cv(xs) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
  return (sd / m) * 100;
}
