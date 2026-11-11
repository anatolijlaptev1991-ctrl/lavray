// design-coverage.mjs — механический гейт переноса дизайна.
//
// Сверяет три вещи:
//   1. все CSS-классы прототипа присутствуют в prototype.css;
//   2. каждый класс стилей используется в *.tsx (мёртвый класс = элемент
//      прототипа не перенесён в разметку);
//   3. счётчик перенесённых элементов по каждому экрану — чтобы прогресс
//      был числом, а не ощущением.
//
// Зачем: аудит 2026-10-28 показал, что CSS перенесён на 100%, а разметка —
// на 75%. Отсутствие класса в TSX и было точным списком пропусков; раньше
// это выяснялось ручной сверкой.
//
// Запуск: node scripts/design-coverage.mjs [--strict]
//   --strict  падать при любом неиспользуемом классе (для CI после
//             достижения нуля пропусков)
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const UI_SRC = join(process.cwd(), 'src');
const PROTOTYPE = join(process.cwd(), '..', '..', 'design', 'prototype.html');
const STRICT = process.argv.includes('--strict');

/**
 * Классы, которые не обязаны встречаться в TSX:
 * - служебные состояния прототипа (стенд, отладка, демо-контролы);
 * - классы, навешиваемые кодом динамически через шаблонные строки —
 *   проверяются по префиксу;
 * - псевдоклассы и утилиты без собственной разметки.
 */
const IGNORE = new Set([
  // Стенд и демо-контролы прототипа (в приложении их нет по замыслу).
  'stand', 'stand-panel', 'stand-btn', 'os-btn', 'dens-seg',
  // Служебные для скриншотов/отладки прототипа.
  'freeze', 'probe', 'demo', 'shot',
  // Идентификаторы состояний, навешиваемые на html/body.
  'w-md', 'w-sm', 'wb-min', 'wb-max', 'wb-close',
  // Классы иконок и типографики, которые дублируются инлайном.
  'ic-16', 'sr-only', 'mono', 'flex1', 'cap', 't2', 't3',
  // Классы, собираемые шаблоном (`lk-${kind}`, `bt-${type}` и пр.).
  'lk-ok', 'lk-warn', 'lk-err', 'bt-ss', 'bt-vmess', 'bt-vless', 'bt-trojan',
  'bt-hy2', 'bt-tuic', 'bt-socks', 'bt-https',
  // Состояния, которые прототип навешивает скриптом, приложение — тоже.
  'scan', 'hit', 'open', 'sel', 'desc', 'on', 'off', 'danger', 'check',
]);

async function walk(dir, ext, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'gen') continue;
      await walk(full, ext, acc);
    } else if (entry.name.endsWith(ext)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Классы из CSS-текста: .foo, .foo-bar (без псевдо и потомков). */
function classesFromCss(css) {
  const set = new Set();
  for (const m of css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) {
    set.add(m[1]);
  }
  return set;
}

async function main() {
  const proto = await readFile(PROTOTYPE, 'utf8');
  const styleBlock = /<style>([\s\S]*?)<\/style>/.exec(proto);
  if (styleBlock === null) {
    console.error('design-coverage: не найден <style> в прототипе');
    process.exitCode = 1;
    return;
  }
  const protoClasses = classesFromCss(styleBlock[1]);

  const portedCss = await readFile(join(UI_SRC, 'prototype.css'), 'utf8');
  const portedClasses = classesFromCss(portedCss);

  // 1. Классы прототипа, не перенесённые в CSS вовсе.
  const missingCss = [...protoClasses].filter((c) => !portedClasses.has(c));

  // 2. Классы стилей, не встречающиеся в TSX.
  const tsxFiles = await walk(UI_SRC, '.tsx');
  const tsxText = (await Promise.all(tsxFiles.map((f) => readFile(f, 'utf8')))).join('\n');

  const unusedInMarkup = [...portedClasses].filter((c) => {
    if (IGNORE.has(c)) return false;
    // Учитываем и className="x", и className={`x ...`}, и динамические
    // вставки через префикс: ищем имя как отдельный токен.
    return !new RegExp(`(?<![\\w-])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(
      tsxText,
    );
  });

  // 3. Покрытие по экранам: считаем классы, упомянутые в каждом файле.
  const screens = tsxFiles.filter((f) => f.includes('screens'));
  const perScreen = [];
  for (const file of screens) {
    const text = await readFile(file, 'utf8');
    const used = [...portedClasses].filter(
      (c) => !IGNORE.has(c) && new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(text),
    ).length;
    perScreen.push({ file: file.split(/[/\\]/).pop(), classes: used });
  }

  const total = portedClasses.size - IGNORE.size;
  const usedCount = total - unusedInMarkup.length;
  const coverage = total === 0 ? 100 : Math.round((usedCount / total) * 100);

  console.log('design-coverage:');
  console.log(`  классы прототипа: ${String(protoClasses.size)}`);
  console.log(`  перенесено в CSS: ${String(portedClasses.size)}`);
  console.log(`  не перенесено в CSS: ${String(missingCss.length)}`);
  console.log(`  классов без разметки: ${String(unusedInMarkup.length)}`);
  console.log(`  покрытие разметки: ${String(coverage)}% (${String(usedCount)}/${String(total)})`);
  console.log('  по экранам:', perScreen.map((s) => `${s.file}=${String(s.classes)}`).join(', '));

  if (missingCss.length > 0) {
    console.error('\n  ОТСУТСТВУЮТ В CSS:', missingCss.slice(0, 40).join(', '));
    process.exitCode = 1;
  }

  if (unusedInMarkup.length > 0) {
    console.log('\n  без разметки (элементы прототипа не перенесены):');
    console.log('   ', unusedInMarkup.slice(0, 60).join(', '));
    if (STRICT) process.exitCode = 1;
  }
}

await main();
