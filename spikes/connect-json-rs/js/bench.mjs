// SPDX-License-Identifier: GPL-3.0-only

// bench.mjs — замер задержек Rust-спайка и Go-ядра на loopback.
//   node bench.mjs --go lavray-core.exe --rust connect-spike.exe --loadgen loadgen.exe --work DIR [--runs 10] [--out result.json]
// Два клиента: Node (node:http, ближе к реальному UI, но медленный) и нативный loadgen на hyper.
// Серверы живут одновременно; внутри каждого прогона порядок Rust/Go чередуется,
// чтобы дрейф фоновой нагрузки (VPN и пр.) не доставался только одному из них.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer, memory, TOKEN } from './servers.mjs';
import { unary, firstFrame, sequential, parallel, summarize, median, cv } from './bench-lib.mjs';

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const RUNS = Number(arg('--runs', 10));
const SEQ = 10000;
const LOADGEN = resolve(arg('--loadgen'));
const WORKERS = 50;
const PER = 200;
const STREAMS = 500;
const RPCS = {
  GetStatus: '/lavray.v1.CoreService/GetStatus',
  StopTests: '/lavray.v1.ProfileService/StopTests',
};

const work = resolve(arg('--work'));
mkdirSync(work, { recursive: true });
const servers = {
  rust: await startServer('rust', resolve(arg('--rust')), work),
  go: await startServer('go', resolve(arg('--go')), work),
};

async function one(srv) {
  const res = {};
  for (const [name, path] of Object.entries(RPCS)) {
    const call = () => unary(srv.url, path, TOKEN);
    await sequential(1000, call); // прогрев
    const seq = summarize(await sequential(SEQ, call));
    const par = await parallel(WORKERS, PER, call);
    const native = JSON.parse(execFileSync(LOADGEN, [srv.url, TOKEN, path], { encoding: 'utf8' }));
    res[name] = { seq, par: { ...summarize(par.lat), rps: par.rps }, nseq: native.seq, npar: native.par };
  }
  const call = () => firstFrame(srv.url, TOKEN);
  await sequential(50, call);
  res.StreamFirstFrame = summarize(await sequential(STREAMS, call));
  return res;
}

const results = { rust: [], go: [] };
const idle = { rust: memory(servers.rust.pid), go: memory(servers.go.pid) };
for (let i = 0; i < RUNS; i++) {
  const order = i % 2 === 0 ? ['rust', 'go'] : ['go', 'rust'];
  for (const k of order) results[k].push(await one(servers[k]));
  console.error(`прогон ${i + 1}/${RUNS} готов`);
}
const after = { rust: memory(servers.rust.pid), go: memory(servers.go.pid) };
await Promise.all(Object.values(servers).map((s) => s.stop()));
writeFileSync(arg('--out', resolve(work, 'bench.json')), JSON.stringify({ RUNS, SEQ, WORKERS, PER, idle, after, results }, null, 1));

// ---- сводка: медиана по прогонам и CV (%) p50/p99 между прогонами ----
const pick = (k, rpc, mode, stat) => results[k].map((r) => (mode ? r[rpc][mode][stat] : r[rpc][stat]));
const row = (label, rpc, mode) => {
  const cell = (k) => {
    const p50 = pick(k, rpc, mode, 'p50');
    const p99 = pick(k, rpc, mode, 'p99');
    return `${median(p50).toFixed(0)} (${cv(p50).toFixed(0)}%) | ${median(p99).toFixed(0)} (${cv(p99).toFixed(0)}%)`;
  };
  const rps = mode?.endsWith('par') ? ` | ${median(pick('rust', rpc, mode, 'rps')).toFixed(0)} / ${median(pick('go', rpc, mode, 'rps')).toFixed(0)}` : ' | -';
  console.log(`| ${label} | ${cell('rust')} | ${cell('go')}${rps} |`);
};
console.log('| Сценарий | Rust p50, мкс (CV) | Rust p99 (CV) | Go p50 (CV) | Go p99 (CV) | rps Rust / Go |');
console.log('|---|---|---|---|---|---|');
for (const rpc of Object.keys(RPCS)) {
  row(`${rpc}, 10 000 последовательных, нативный клиент`, rpc, 'nseq');
  row(`${rpc}, 50 параллельных, нативный клиент`, rpc, 'npar');
  row(`${rpc}, 10 000 последовательных, Node-клиент`, rpc, 'seq');
  row(`${rpc}, 50 параллельных, Node-клиент`, rpc, 'par');
}
row(`SubscribeEvents, до первого кадра (×${STREAMS})`, 'StreamFirstFrame', null);
const mb = (b) => (b / 1048576).toFixed(1);
for (const k of ['rust', 'go']) {
  console.log(`RSS ${k}: до нагрузки ${mb(idle[k].ws)} МиБ, после ${mb(after[k].ws)}, пик ${mb(after[k].peak)}, private ${mb(after[k].priv)}`);
}
