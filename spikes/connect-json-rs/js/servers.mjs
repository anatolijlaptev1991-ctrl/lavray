// SPDX-License-Identifier: GPL-3.0-only

// servers.mjs — запуск Go-ядра и Rust-спайка на loopback и замер памяти процесса.
// Оба читают токен одной строкой со stdin, печатают LAVRAY_CORE_READY tcp://адрес
// и завершаются по EOF stdin. Никаких портов, кроме 127.0.0.1:0 (выдаёт ОС).
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export const TOKEN = 'spike-token-' + Math.random().toString(16).slice(2);

/** Запускает сервер и ждёт строку готовности. kind: 'go' | 'rust'. */
export async function startServer(kind, exe, workDir) {
  let args;
  if (kind === 'go') {
    const data = join(workDir, 'godata');
    mkdirSync(data, { recursive: true });
    args = ['serve', '--listen-socket', '127.0.0.1:0', '--data', data];
  } else {
    args = ['serve', '--listen', '127.0.0.1:0'];
  }
  const proc = spawn(exe, args, { stdio: ['pipe', 'pipe', 'ignore'] });
  proc.stdin.write(TOKEN + '\n');
  const lines = createInterface({ input: proc.stdout });
  const ready = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(kind + ': нет READY за 60 с')), 60000);
    lines.once('line', (l) => {
      clearTimeout(t);
      resolve(l);
    });
    proc.once('exit', (c) => reject(new Error(`${kind}: выход ${c} до READY`)));
  });
  lines.on('line', () => {});
  const url = 'http://' + ready.split(' ')[1].replace('tcp://', '');
  const exited = new Promise((r) => proc.once('exit', r));
  return {
    kind,
    url,
    pid: proc.pid,
    async stop() {
      proc.stdin.end();
      const timer = setTimeout(() => proc.kill(), 20000);
      await exited;
      clearTimeout(timer);
    },
  };
}

/** Рабочий набор, пик и приватная память процесса (байты) через PowerShell. */
export function memory(pid) {
  const cmd = `$p=Get-Process -Id ${pid}; "$($p.WorkingSet64) $($p.PeakWorkingSet64) $($p.PrivateMemorySize64)"`;
  const out = execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' });
  const [ws, peak, priv] = out.trim().split(/\s+/).map(Number);
  return { ws, peak, priv };
}
