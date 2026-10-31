#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Размерная «трещотка» исходников (Ф1.0): большие файлы не растут, новые короткие.

    python scripts/size_ratchet.py                    # проверка; код 1 при нарушении
    python scripts/size_ratchet.py --write-baseline   # пересобрать scripts/size-ratchet.json
    python scripts/size_ratchet.py --root DIR --baseline FILE

Правило для файлов кода (.go, .rs, .ts, .tsx, .py) из git (отслеживаемых и новых,
не попавших под .gitignore):
  * файл, записанный в baseline, не длиннее своего числа строк;
  * файл вне baseline — не длиннее NEW_FILE_LIMIT (200) строк.
Не считаются: сгенерированный код (core/internal/gen/, ui/src/gen/), словари
интерфейса (ui/src/lib/dictionaries/ — данные, растут с каждой функцией), тесты
(*_test.go, *.test.ts, *.test.tsx, shell/src/**/tests.rs, shell/tests/,
scripts/tests/, testdata/), node_modules, target, dist.

Baseline уменьшается, а не растёт: файл стал короче или исчез — скрипт подскажет,
что строку можно снизить, а `--write-baseline` пересоберёт файл. Только стандартная
библиотека; ничего не запускает, кроме `git ls-files`.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path, PurePosixPath

NEW_FILE_LIMIT = 200
CODE_EXTS = (".go", ".rs", ".ts", ".tsx", ".py")
SKIP_DIRS = frozenset({"node_modules", "target", "dist", "testdata"})
GENERATED_PREFIXES = ("core/internal/gen/", "ui/src/gen/")
# Данные, а не логика: словари i18n дописываются каждой новой функцией.
DATA_PREFIXES = ("ui/src/lib/dictionaries/",)
TEST_SUFFIXES = ("_test.go", ".test.ts", ".test.tsx")
TEST_DIR_PREFIXES = ("shell/tests/", "scripts/tests/")
BASELINE_PATH = "scripts/size-ratchet.json"


def is_checked(rel: str) -> bool:
    """Файл кода, на который распространяется правило (rel — путь с «/»)."""
    path = PurePosixPath(rel)
    if path.suffix not in CODE_EXTS or SKIP_DIRS.intersection(path.parts):
        return False
    if rel.startswith(GENERATED_PREFIXES + DATA_PREFIXES) or rel.startswith(TEST_DIR_PREFIXES):
        return False
    if rel.endswith(TEST_SUFFIXES):
        return False
    return not (rel.startswith("shell/src/") and path.name == "tests.rs")


def count_lines(path: Path) -> int:
    """Число строк как у `wc -l`, плюс последняя строка без перевода строки."""
    data = path.read_bytes()
    return data.count(b"\n") + (1 if data and not data.endswith(b"\n") else 0)


def git_files(root: Path) -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=root,
        capture_output=True,
        check=True,
    ).stdout.decode("utf-8")
    return sorted({p for p in out.split("\0") if p})


def measure(root: Path) -> dict[str, int]:
    """Путь → число строк для всех проверяемых файлов, которые есть на диске."""
    sizes = {}
    for rel in git_files(root):
        if is_checked(rel) and (root / rel).is_file():
            sizes[rel] = count_lines(root / rel)
    return sizes


def load_baseline(path: Path) -> dict[str, int]:
    data = json.loads(path.read_text(encoding="utf-8"))
    ok = isinstance(data, dict) and all(
        isinstance(k, str) and isinstance(v, int) and not isinstance(v, bool) and v > 0
        for k, v in data.items()
    )
    if not ok:
        raise ValueError("ждём объект «путь: число строк» с положительными числами")
    return data


def baseline_from(sizes: dict[str, int]) -> dict[str, int]:
    return {rel: n for rel, n in sorted(sizes.items()) if n > NEW_FILE_LIMIT}


def violations(sizes: dict[str, int], baseline: dict[str, int]) -> list[str]:
    bad = []
    for rel, n in sorted(sizes.items()):
        if rel in baseline:
            if n > baseline[rel]:
                bad.append(
                    f"{rel}: {n} строк, в baseline {baseline[rel]}. Большой файл не растёт: "
                    "новую логику вынесите в новый файл"
                )
        elif n > NEW_FILE_LIMIT:
            bad.append(f"{rel}: {n} строк, новый файл не длиннее {NEW_FILE_LIMIT}")
    return bad


def improvements(sizes: dict[str, int], baseline: dict[str, int]) -> list[str]:
    """Записи baseline, которые уже можно снизить или убрать."""
    notes = []
    for rel, limit in sorted(baseline.items()):
        n = sizes.get(rel)
        if n is None:
            notes.append(f"{rel}: файла нет, уберите из baseline")
        elif n < limit:
            notes.append(f"{rel}: {n} строк при пороге {limit}, порог можно снизить")
    return notes


def write_baseline(path: Path, baseline: dict[str, int]) -> None:
    text = json.dumps(baseline, ensure_ascii=False, indent=2) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def repo_root(arg: str | None) -> Path:
    if arg is not None:
        return Path(arg).resolve()
    out = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True
    ).stdout.strip()
    return Path(out)


def main(argv: list[str]) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # одинаковый вывод в любой консоли Windows
    ap = argparse.ArgumentParser(description="Размерная трещотка исходников")
    ap.add_argument("--root", help="корень репозитория (по умолчанию — git toplevel)")
    ap.add_argument("--baseline", help=f"файл baseline (по умолчанию {BASELINE_PATH})")
    ap.add_argument("--write-baseline", action="store_true", help="пересобрать baseline по текущему дереву")
    args = ap.parse_args(argv)

    root = repo_root(args.root)
    baseline_file = Path(args.baseline) if args.baseline else root / BASELINE_PATH
    sizes = measure(root)

    if args.write_baseline:
        baseline = baseline_from(sizes)
        write_baseline(baseline_file, baseline)
        print(f"size_ratchet: записано {len(baseline)} файлов в {baseline_file.name}")
        return 0

    try:
        baseline = load_baseline(baseline_file)
    except (OSError, ValueError) as err:  # json.JSONDecodeError — подкласс ValueError
        print(f"size_ratchet: baseline {baseline_file} не читается ({err}); "
              "создайте его: python scripts/size_ratchet.py --write-baseline")
        return 2

    for note in improvements(sizes, baseline):
        print("можно снизить:", note)
    bad = violations(sizes, baseline)
    for line in bad:
        print("нарушение:", line)
    print(f"size_ratchet: проверено {len(sizes)} файлов, нарушений: {len(bad)}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
