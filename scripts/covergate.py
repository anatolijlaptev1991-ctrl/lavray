#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Порог покрытия по путям (Ф1.0): профили Go и lcov против scripts/coverage.yaml.

    python scripts/covergate.py --go cover.out --only core/
    python scripts/covergate.py --lcov ui/coverage/lcov.info=ui/ --only ui/
    python scripts/covergate.py --lcov shell/lcov.info --root . --only shell/

Профили (флаги повторяются, форматы можно смешивать):
  --go FILE            профиль `go test -coverprofile`: строка `mode:`, затем
                       `файл:нач.кол,кон.кол числоОператоров счётчик`. Покрытие —
                       доля покрытых операторов, как у `go tool cover`. Путь модуля
                       `github.com/anatolijlaptev1991-ctrl/lavray/` (--go-prefix)
                       срезается, остаётся путь от корня репозитория.
  --lcov FILE[=PREFIX] lcov (vitest, cargo llvm-cov): записи SF/DA/end_of_record,
                       покрытие — доля строк с DA > 0. Относительные SF получают
                       PREFIX (vitest пишет пути от каталога ui, значит `=ui/`),
                       абсолютные SF внутри --root становятся относительными.

Конфиг coverage.yaml — малое подмножество YAML (парсится здесь же, без зависимостей):

    thresholds:                          # либо `thresholds: {}`
      core/internal/traffic/: 90         # префикс пути от корня репозитория: минимум, %
      core/internal/api/agent_table.go: 85.5

Префикс — начало пути (каталог оканчивайте на «/»); проценты считаются по сумме всех
файлов с этим префиксом. --only PREFIX проверяет только записи конфига с таким началом
(каждое задание CI смотрит свои пути). Код выхода: 0 — всё в норме; 1 — покрытие ниже
порога или по записи конфига нет данных в профилях; 2 — ошибка запуска, конфига или
профиля.
"""
import argparse
import re
import sys
from fractions import Fraction
from pathlib import Path

GO_MODULE_PREFIX = "github.com/anatolijlaptev1991-ctrl/lavray/"
CONFIG_PATH = "scripts/coverage.yaml"
NUMBER = re.compile(r"^\d+(\.\d+)?$")

# файл -> {единица покрытия: (вес, покрыта)}. Go: единица — блок, вес — число
# операторов; lcov: единица — номер строки, вес — 1.
Cover = dict[str, dict[str, tuple[int, bool]]]


class InputError(Exception):
    """Ошибка конфига или профиля (код выхода 2)."""


def add_unit(cover: Cover, file: str, unit: str, weight: int, covered: bool) -> None:
    """Добавляет единицу; повтор (слияние профилей) считается покрытым, если покрыт хоть раз."""
    units = cover.setdefault(file, {})
    old_weight, old_covered = units.get(unit, (weight, False))
    units[unit] = (max(weight, old_weight), covered or old_covered)


def parse_go(text: str, strip_prefix: str, cover: Cover) -> None:
    lines = text.splitlines()
    if not lines or not lines[0].startswith("mode:"):
        raise InputError("профиль Go: нет строки «mode:» в начале")
    for no, line in enumerate(lines[1:], 2):
        if not line.strip():
            continue
        file, sep, rest = line.rpartition(":")
        fields = rest.split()
        if not sep or len(fields) != 3 or not all(f.isdigit() for f in fields[1:]):
            raise InputError(f"профиль Go, строка {no}: ждём «файл:нач.кол,кон.кол операторы счётчик»: {line!r}")
        name = file.replace("\\", "/").removeprefix(strip_prefix)
        add_unit(cover, name, fields[0], int(fields[1]), int(fields[2]) > 0)


def normalize_sf(sf: str, prefix: str, root: str) -> str:
    path = sf.strip().replace("\\", "/").removeprefix("./")
    if path.startswith("/") or re.match(r"^[A-Za-z]:/", path):
        if path.lower().startswith(root.lower() + "/"):
            return path[len(root) + 1:]
        return path
    return prefix + path


def parse_lcov(text: str, prefix: str, root: str, cover: Cover) -> None:
    current = None
    for no, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if line.startswith("SF:"):
            current = normalize_sf(line[3:], prefix, root)
        elif line == "end_of_record":
            current = None
        elif line.startswith("DA:"):
            if current is None:
                raise InputError(f"lcov, строка {no}: DA вне записи SF")
            fields = line[3:].split(",")
            if len(fields) < 2 or not fields[0].isdigit() or not fields[1].lstrip("-").isdigit():
                raise InputError(f"lcov, строка {no}: ждём «DA:строка,счётчик»: {line!r}")
            add_unit(cover, current, fields[0], 1, int(fields[1]) > 0)


def parse_config(text: str) -> dict[str, Fraction]:
    """Подмножество YAML: ключ `thresholds` с вложенными `префикс: число` (или `{}`)."""
    thresholds: dict[str, Fraction] = {}
    inside = False
    seen = False
    for no, raw in enumerate(text.splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        line = raw.split(" #")[0].rstrip()
        if not raw[0].isspace():
            key, _, rest = line.partition(":")
            if key.strip() != "thresholds" or seen or rest.strip() not in ("", "{}"):
                raise InputError(f"конфиг, строка {no}: ждём один раздел «thresholds:» или «thresholds: {{}}»")
            seen, inside = True, rest.strip() == ""
            continue
        if not inside:
            raise InputError(f"конфиг, строка {no}: вложенная запись вне «thresholds:»")
        key, sep, value = line.strip().rpartition(":")
        key = key.strip().strip("\"'")
        percent = Fraction(value.strip()) if NUMBER.match(value.strip()) else None
        if not sep or not key or percent is None or percent > 100:
            raise InputError(f"конфиг, строка {no}: ждём «префикс: процент от 0 до 100»: {line.strip()!r}")
        if key in thresholds:
            raise InputError(f"конфиг, строка {no}: префикс {key!r} указан дважды")
        thresholds[key] = percent
    return thresholds


def totals(cover: Cover, prefix: str) -> tuple[int, int, int]:
    """(покрыто, всего, число файлов) по файлам с префиксом."""
    covered = total = files = 0
    for name, units in cover.items():
        if name.startswith(prefix):
            files += 1
            total += sum(w for w, _ in units.values())
            covered += sum(w for w, hit in units.values() if hit)
    return covered, total, files


def check(cover: Cover, thresholds: dict[str, Fraction]) -> tuple[list[str], int]:
    """Строки отчёта и число нарушений. Сравнение точное: без ошибок плавающей точки."""
    report, bad = [], 0
    for prefix, need in sorted(thresholds.items()):
        covered, total, files = totals(cover, prefix)
        shown = f"{float(need):g}"
        if total == 0:
            report.append(f"НЕТ ДАННЫХ  {prefix}: в профилях нет файлов с этим префиксом (порог {shown}%)")
            bad += 1
            continue
        got = Fraction(covered * 100, total)
        ok = got >= need
        mark = "ok         " if ok else "НИЖЕ ПОРОГА"
        report.append(f"{mark} {prefix}: {float(got):.2f}% при пороге {shown}% ({covered}/{total}, файлов: {files})")
        bad += 0 if ok else 1
    return report, bad


def read(path: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8")
    except OSError as err:
        raise InputError(f"не прочитать {path}: {err}") from err


def main(argv: list[str]) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # одинаковый вывод в любой консоли Windows
    ap = argparse.ArgumentParser(description="Порог покрытия по путям")
    ap.add_argument("--config", default=CONFIG_PATH, help=f"файл порогов (по умолчанию {CONFIG_PATH})")
    ap.add_argument("--go", action="append", default=[], metavar="FILE", help="профиль go test -coverprofile")
    ap.add_argument("--go-prefix", default=GO_MODULE_PREFIX, help="срезаемое начало пути модуля Go")
    ap.add_argument("--lcov", action="append", default=[], metavar="FILE[=PREFIX]", help="файл lcov")
    ap.add_argument("--root", default=".", help="корень репозитория для абсолютных путей lcov")
    ap.add_argument("--only", action="append", default=[], metavar="PREFIX", help="проверять только такие записи конфига")
    args = ap.parse_args(argv)
    try:
        thresholds = parse_config(read(args.config))
        cover: Cover = {}
        for path in args.go:
            parse_go(read(path), args.go_prefix, cover)
        root = Path(args.root).resolve().as_posix()
        for spec in args.lcov:
            path, _, prefix = spec.partition("=")
            parse_lcov(read(path), prefix, root, cover)
    except InputError as err:
        print(f"covergate: {err}")
        return 2
    if args.only:
        thresholds = {p: v for p, v in thresholds.items() if p.startswith(tuple(args.only))}
    if not thresholds:
        print("covergate: пороги не заданы, проверять нечего")
        return 0
    report, bad = check(cover, thresholds)
    for line in report:
        print(line)
    print(f"covergate: записей {len(report)}, нарушений: {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
