#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Бюджет бандла UI (D-3): JS, который грузится до первого кадра, ≤ 250 КБ gzip.

    python scripts/check_bundle_budget.py                  # ui/dist после `npm run build`
    python scripts/check_bundle_budget.py --dist DIR --limit-kib 250

Бюджет из docs/TEST-PLAN.md («бандл ≤ 250 КБ gzip»). Считается сумма gzip всех
JS-файлов, которые index.html тянет сразу: <script type="module"> и
<link rel="modulepreload">, плюс всё, что они импортируют статически
(`import … from "./x.js"`, `import "./x.js"`, `export … from "./x.js"`).
Динамические `import("./x.js")` (экраны, диалоги, словари) в сумму не входят —
они грузятся по требованию. Вынос того же кода в отдельный чанк, который всё
равно подключается при старте, бюджет не снижает: чанк попадёт в сумму.

Коды возврата: 0 — в бюджете; 1 — превышен; 2 — dist не читается или в
index.html нет ни одного модульного скрипта (проверять нечего — это ошибка,
а не успех). Только стандартная библиотека.
"""
import argparse
import gzip
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

DEFAULT_LIMIT_KIB = 250
# Статический импорт: import … from "x.js", import "x.js", export … from "x.js".
# `import(` (динамический) не совпадает: после import нет кавычки и нет from.
_STATIC_FROM = re.compile(r"""\b(?:import|export)\b[^;"'()]*?\bfrom\s*["']([^"']+\.js)["']""")
_STATIC_BARE = re.compile(r"""\bimport\s*["']([^"']+\.js)["']""")


class _HtmlRefs(HTMLParser):
    """Собирает адреса модульных скриптов и modulepreload из index.html."""

    def __init__(self) -> None:
        super().__init__()
        self.refs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        if tag == "script" and a.get("type") == "module" and a.get("src"):
            self.refs.append(a["src"] or "")
        elif tag == "link" and a.get("rel") == "modulepreload" and a.get("href"):
            self.refs.append(a["href"] or "")


def html_refs(html: str) -> list[str]:
    parser = _HtmlRefs()
    parser.feed(html)
    return parser.refs


def resolve(dist: Path, base: Path, ref: str) -> Path | None:
    """Файл внутри dist по ссылке из HTML ('/assets/x.js') или чанка ('./x.js'); иначе None."""
    if re.match(r"^[a-z][a-z0-9+.-]*:|^//", ref, re.I):
        return None  # внешний адрес: размер не измерить, в бюджет не входит
    ref = ref.split("?", 1)[0].split("#", 1)[0]
    target = (dist / ref.lstrip("/")) if ref.startswith("/") else (base / ref)
    target = target.resolve()
    return target if target.is_relative_to(dist.resolve()) and target.is_file() else None


def static_imports(js: str) -> list[str]:
    return _STATIC_FROM.findall(js) + _STATIC_BARE.findall(js)


def eager_files(dist: Path, html: str) -> tuple[list[Path], list[str]]:
    """Все JS, которые грузятся при старте (с транзитивными статическими импортами)."""
    found: dict[Path, None] = {}
    problems: list[str] = []
    queue = [(dist, ref) for ref in html_refs(html)]
    while queue:
        base, ref = queue.pop(0)
        path = resolve(dist, base, ref)
        if path is None:
            problems.append(ref)
            continue
        if path in found:
            continue
        found[path] = None
        text = path.read_text(encoding="utf-8", errors="replace")
        queue.extend((path.parent, imp) for imp in static_imports(text))
    return list(found), problems


def gzip_size(path: Path) -> int:
    return len(gzip.compress(path.read_bytes(), compresslevel=9, mtime=0))


def kib(n: int) -> str:
    return f"{n / 1024:.2f} КиБ"


def main(argv: list[str]) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # одинаковый вывод в любой консоли Windows
    default_dist = Path(__file__).resolve().parent.parent / "ui" / "dist"
    ap = argparse.ArgumentParser(description="Бюджет gzip для JS первого экрана")
    ap.add_argument("--dist", type=Path, default=default_dist, help="каталог сборки UI (по умолчанию ui/dist)")
    ap.add_argument("--limit-kib", type=float, default=DEFAULT_LIMIT_KIB, help="бюджет, КиБ gzip (250)")
    args = ap.parse_args(argv)

    index = args.dist / "index.html"
    try:
        html = index.read_text(encoding="utf-8")
    except OSError as err:
        print(f"check_bundle_budget: {index} не читается ({err}); сначала выполните `npm run build` в ui/")
        return 2
    files, skipped = eager_files(args.dist, html)
    for ref in skipped:
        print(f"пропущено (внешний адрес или нет файла в dist): {ref}")
    if not files:
        print(f"check_bundle_budget: в {index} нет модульных скриптов; бандл не проверен")
        return 2

    limit = int(args.limit_kib * 1024)
    sizes = [(p, gzip_size(p)) for p in files]
    for path, size in sizes:
        print(f"  {path.relative_to(args.dist.resolve()).as_posix():<44} {kib(size):>12} gzip")
    total = sum(size for _, size in sizes)
    verdict = "в бюджете" if total <= limit else "ПРЕВЫШЕН"
    print(f"check_bundle_budget: JS до первого кадра {kib(total)} gzip при бюджете {kib(limit)} — {verdict}")
    if total > limit:
        print("Вынесите экран/диалог/словарь в React.lazy или import(); перенос в vendor-чанк, "
              "подключаемый при старте, бюджет не снижает.")
    return 0 if total <= limit else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
