// preview-server.mjs — общий статический сервер для визуальных проверок.
// Раньше каждый проверочный скрипт поднимал свой сервер на своём порту;
// теперь один модуль, чтобы гейт и ad-hoc проверки вели себя одинаково.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Поднимает сервер над каталогом `root`.
 * Возвращает { url, close } — url подставляется в page.goto.
 */
export async function serveDir(root, port = 0) {
  const server = createServer(async (req, res) => {
    try {
      const path = (req.url ?? '/').split('?')[0];
      const file = join(root, path === '/' ? 'index.html' : path);
      // Никакого выхода за пределы root: визуальные проверки не должны
      // уметь читать произвольные файлы машины.
      if (!file.startsWith(root)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(data);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const addr = server.address();
  const actual = typeof addr === 'object' && addr !== null ? addr.port : port;
  return {
    url: `http://127.0.0.1:${String(actual)}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
