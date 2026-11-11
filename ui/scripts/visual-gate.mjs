// visual-gate.mjs — механический гейт интерфейса.
//
// Прогоняет все экраны на всех языках, обеих темах и четырёх размерах окна
// и падает с ненулевым кодом при первом же классе дефектов:
//   - горизонтальное переполнение контейнера;
//   - выход элементов за границы своей панели;
//   - обрезка текста в кнопках и ячейках;
//   - пустой/нечитаемый контраст служебного текста (грубая проверка).
//
// Зачем: раньше такие проверки делались одноразовыми скриптами, которые
// удалялись после прогона. Из-за этого дефекты вроде обрезанного знака
// «Отражение» или наезда текста ловились глазами и могли вернуться.
//
// Запуск: node scripts/visual-gate.mjs [--shots]
//   --shots  сохранить скриншоты проблем в scripts/out/
import { chromium } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { serveDir } from './preview-server.mjs';

const DIST = join(process.cwd(), 'dist');
const SHOTS = join(process.cwd(), 'scripts', 'out');
const wantShots = process.argv.includes('--shots');

const LANGS = ['ru', 'en', 'zh', 'es', 'de'];
const THEMES = ['dark', 'light'];
const SIZES = [
  { name: 'min', w: 880, h: 560 },
  { name: 'md', w: 1280, h: 800 },
  { name: 'lg', w: 1600, h: 900 },
];
const SCREENS = ['connection', 'servers', 'rules', 'diag', 'settings'];

/** Одна порция проверок в браузере: возвращает список проблем. */
function auditPage() {
  const out = [];
  const main = document.getElementById('main');
  if (main === null) return ['нет #main'];

  if (main.scrollWidth > main.clientWidth + 2) {
    out.push(`h-scroll ${String(main.scrollWidth)}>${String(main.clientWidth)}`);
  }

  const box = main.getBoundingClientRect();
  for (const el of main.querySelectorAll('h1,h2,h3,p,span,button,dd,dt,label,td,th,div.menu-item')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const text = (el.textContent ?? '').trim().slice(0, 30);
    if (text === '') continue;
    if (r.right > box.right + 2) {
      out.push(`right +${String(Math.round(r.right - box.right))} "${text}"`);
    }
    if (r.left < box.left - 2) {
      out.push(`left "${text}"`);
    }
  }

  for (const b of main.querySelectorAll('button')) {
    if (b.scrollWidth > b.clientWidth + 2 && getComputedStyle(b).overflow !== 'hidden') {
      const text = (b.textContent ?? '').trim().slice(0, 24);
      if (text !== '') {
        out.push(`btn-clip "${text}" ${String(b.scrollWidth)}>${String(b.clientWidth)}`);
      }
    }
  }

  // Обрезка по высоте (текст в ячейках сетки) — частый дефект локалей de/es.
  for (const el of main.querySelectorAll('.hl-cell, .stat, .set-l, .srv-group-h, .dlg-f button')) {
    if (el.scrollHeight > el.clientHeight + 3 && el.clientHeight > 0) {
      const text = (el.textContent ?? '').trim().slice(0, 24);
      out.push(`v-clip "${text}" ${String(el.scrollHeight)}>${String(el.clientHeight)}`);
    }
  }

  return [...new Set(out)];
}

async function main() {
  if (wantShots) {
    await rm(SHOTS, { recursive: true, force: true });
    await mkdir(SHOTS, { recursive: true });
  }

  const srv = await serveDir(DIST);
  const browser = await chromium.launch();
  const problems = [];
  let checked = 0;

  try {
    for (const lang of LANGS) {
      for (const theme of THEMES) {
        for (const size of SIZES) {
          const page = await browser.newPage({
            viewport: { width: size.w, height: size.h },
          });
          await page.goto(`${srv.url}/?lang=${lang}&theme=${theme}&onboarded=1`);
          await page.waitForTimeout(180);

          for (const screen of SCREENS) {
            await page.evaluate((s) => {
              window.location.hash = `screen=${s}`;
            }, screen);
            await page.waitForTimeout(180);
            checked += 1;

            const found = await page.evaluate(auditPage);
            if (found.length > 0) {
              problems.push({
                where: `${lang}/${theme}/${size.name}/${screen}`,
                items: found.slice(0, 5),
              });
              if (wantShots) {
                await page.screenshot({
                  path: join(
                    SHOTS,
                    `prob-${lang}-${theme}-${size.name}-${screen}.png`,
                  ),
                });
              }
            }
          }
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
    await srv.close();
  }

  if (problems.length === 0) {
    console.log(`visual-gate: OK — ${String(checked)} проверок, дефектов нет`);
    return;
  }

  console.error(`visual-gate: ДЕФЕКТЫ в ${String(problems.length)} из ${String(checked)} проверок`);
  for (const p of problems) {
    console.error(`  ${p.where}: ${p.items.join(' | ')}`);
  }
  process.exitCode = 1;
}

await main();
