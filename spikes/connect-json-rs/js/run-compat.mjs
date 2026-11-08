// SPDX-License-Identifier: GPL-3.0-only

// run-compat.mjs — совместимость Rust-спайка с Go-ядром через настоящий клиент UI.
//   node run-compat.mjs --go lavray-core.exe --rust connect-spike.exe --work DIR
// Нужны ui/node_modules (берётся NODE_MODULES, по умолчанию ../../../ui/node_modules).
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer, TOKEN } from './servers.mjs';
import { rawChecks } from './raw-checks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n) => process.argv[process.argv.indexOf(n) + 1];
const work = resolve(arg('--work'));
const nodeModules = resolve(process.env.NODE_MODULES ?? join(here, '../../../ui/node_modules'));
mkdirSync(work, { recursive: true });

// Сборка клиента: esbuild из node_modules UI, зависимости ищутся через NODE_PATH.
const bundle = join(work, 'compat.bundle.mjs');
execFileSync(
  join(nodeModules, '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild'),
  [join(here, 'compat.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${bundle}`, '--log-level=warning'],
  { env: { ...process.env, NODE_PATH: nodeModules }, stdio: 'inherit', shell: process.platform === 'win32' },
);
const { collect } = await import(pathToFileURL(bundle).href);

const norm = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'tsMs' ? '<ts>' : x)));
const go = await startServer('go', resolve(arg('--go')), work);
const rust = await startServer('rust', resolve(arg('--rust')), work);
let failed = 0;
try {
  const g = norm(await collect(go.url, TOKEN, false));
  const r = norm(await collect(rust.url, TOKEN, true));
  for (const key of Object.keys(g)) {
    const same = JSON.stringify(g[key]) === JSON.stringify(r[key]);
    failed += same ? 0 : 1;
    console.log(`${same ? 'SAME' : 'DIFF'}  ${key}`);
    if (!same) console.log('  go  :', JSON.stringify(g[key]), '\n  rust:', JSON.stringify(r[key]));
  }
  console.log('Rust-only burst :', JSON.stringify(r.streamBurst).slice(0, 400));
  console.log('Rust-only error :', JSON.stringify(r.streamError));
  console.log('\n--- сырой HTTP (статус / content-type / code) ---');
  const gr = await rawChecks(go.url, TOKEN);
  const rr = await rawChecks(rust.url, TOKEN);
  for (const k of Object.keys(gr)) {
    const same = JSON.stringify(gr[k]) === JSON.stringify(rr[k]);
    console.log(`${same ? 'SAME' : 'DIFF'}  ${k}${same ? '' : `\n  go  : ${JSON.stringify(gr[k])}\n  rust: ${JSON.stringify(rr[k])}`}`);
  }
} finally {
  await Promise.all([go.stop(), rust.stop()]);
}
console.log(`\nрасхождений клиентских вызовов: ${failed}`);
process.exit(failed ? 1 : 0);
