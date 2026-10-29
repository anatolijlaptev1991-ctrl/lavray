#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Добавляет (или проверяет) строку SPDX-License-Identifier в исходниках (T-74).

    python scripts/add-spdx.py           # добавить недостающие строки
    python scripts/add-spdx.py --check   # только проверить; код 1, если чего-то не хватает

Обрабатываются отслеживаемые git файлы .go, .rs, .ts, .tsx, кроме сгенерированных
(каталоги gen/, файлы с «Code generated … DO NOT EDIT»). Скрипт идемпотентен:
файл, где в первых пяти строках уже есть SPDX-License-Identifier, не меняется.
Перевод строки (LF/CRLF) и BOM сохраняются.
"""
import subprocess
import sys
from pathlib import Path

LICENSE = "GPL-3.0-only"
LINE = f"// SPDX-License-Identifier: {LICENSE}"
EXTS = (".go", ".rs", ".ts", ".tsx")
BOM = b"\xef\xbb\xbf"


def tracked(root: Path) -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files", "-z"], cwd=root, capture_output=True, check=True
    ).stdout.decode("utf-8")
    return [root / p for p in out.split("\0") if p.endswith(EXTS)]


def is_generated(path: Path, head: bytes) -> bool:
    if "gen" in path.parts:
        return True
    return b"Code generated" in head and b"DO NOT EDIT" in head


def has_tag(head: bytes) -> bool:
    return b"SPDX-License-Identifier" in b"\n".join(head.split(b"\n")[:5])


def with_header(data: bytes) -> bytes:
    bom = BOM if data.startswith(BOM) else b""
    body = data[len(bom):]
    nl = b"\r\n" if b"\r\n" in body[:4096] else b"\n"
    return bom + LINE.encode("utf-8") + nl + nl + body


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # одинаковый вывод в любой консоли Windows
    check = "--check" in sys.argv[1:]
    root = Path(
        subprocess.run(
            ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True
        ).stdout.strip()
    )
    missing = []
    for path in tracked(root):
        data = path.read_bytes()
        head = data[:2048]
        if is_generated(path.relative_to(root), head) or has_tag(head):
            continue
        missing.append(path)
        if not check:
            path.write_bytes(with_header(data))
    rel = [str(p.relative_to(root)).replace("\\", "/") for p in missing]
    if check:
        for r in rel:
            print("нет SPDX:", r)
        print(f"без SPDX-строки: {len(rel)} файл(ов)")
        return 1 if rel else 0
    print(f"добавлено строк SPDX: {len(rel)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
