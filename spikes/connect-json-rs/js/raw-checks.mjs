// SPDX-License-Identifier: GPL-3.0-only

// raw-checks.mjs — крайние случаи, которые клиент UI не создаёт сам: плохой JSON,
// неверный Content-Type, GET, неизвестный путь, CORS preflight, лимит тела.
import http from 'node:http';

function send(base, { method = 'POST', path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + path, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ res, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const codeOf = (text) => {
  try {
    return JSON.parse(text).code ?? null;
  } catch {
    return null;
  }
};

/** Сводка: статус, content-type, код ошибки Connect (если есть). */
export async function rawChecks(base, token) {
  const auth = { authorization: `Bearer ${token}` };
  const json = { ...auth, 'content-type': 'application/json' };
  const cases = {
    badJson: { path: '/lavray.v1.CoreService/GetStatus', headers: json, body: '{bad' },
    wrongContentType: { path: '/lavray.v1.CoreService/GetStatus', headers: { ...auth, 'content-type': 'text/plain' }, body: '{}' },
    getMethod: { method: 'GET', path: '/lavray.v1.CoreService/GetStatus', headers: auth },
    unknownPath: { path: '/lavray.v1.CoreService/Nope', headers: json, body: '{}' },
    noAuth401: { path: '/lavray.v1.CoreService/GetStatus', headers: { 'content-type': 'application/json' }, body: '{}' },
    bareTokenNoScheme: { path: '/lavray.v1.CoreService/GetStatus', headers: { authorization: token, 'content-type': 'application/json' }, body: '{}' },
    healthz: { method: 'GET', path: '/healthz' },
    preflight: {
      method: 'OPTIONS',
      path: '/lavray.v1.CoreService/GetStatus',
      headers: { origin: 'http://127.0.0.1:1420', 'access-control-request-method': 'POST' },
    },
    corsOnPost: { path: '/lavray.v1.CoreService/GetStatus', headers: { ...json, origin: 'http://tauri.localhost' }, body: '{}' },
    foreignOrigin: { path: '/lavray.v1.CoreService/GetStatus', headers: { ...json, origin: 'http://evil.example' }, body: '{}' },
    bodyOver16MiB: { path: '/lavray.v1.ProfileService/StopTests', headers: json, body: '{"x":"' + 'a'.repeat(17 << 20) + '"}' },
  };
  const out = {};
  for (const [name, c] of Object.entries(cases)) {
    let reply;
    try {
      reply = await send(base, c);
    } catch (e) {
      // сервер ответил и закрыл соединение, не дочитав тело: клиент видит сброс
      out[name] = { connectionError: e.code };
      continue;
    }
    const { res, text } = reply;
    const h = res.headers;
    out[name] = {
      status: res.statusCode,
      contentType: h['content-type'] ?? null,
      code: codeOf(text),
      acao: h['access-control-allow-origin'] ?? null,
      acah: h['access-control-allow-headers'] ?? null,
    };
  }
  return out;
}
