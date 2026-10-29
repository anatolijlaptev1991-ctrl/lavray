#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Проверяемые факты о репозитории LAVRay (задача T-74).

Числа, которые раньше писались в README и в самооценке вручную и расходились
с кодом, считаются здесь по исходникам. Запуск из любого каталога репозитория:

    python scripts/repo-stats.py

Только стандартная библиотека; ничего не запускает и не меняет.
"""
import re
import subprocess
import sys
from pathlib import Path


def repo_root() -> Path:
    out = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True
    ).stdout.strip()
    return Path(out)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def tracked(root: Path) -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-z"], cwd=root, capture_output=True, check=True
    ).stdout.decode("utf-8")
    return [p for p in out.split("\0") if p]


def proto_stats(root: Path) -> dict:
    text = read(root / "proto" / "lavray.proto")
    services = {}
    for m in re.finditer(r"^service\s+(\w+)\s*\{(.*?)^\}", text, re.M | re.S):
        services[m.group(1)] = re.findall(r"^\s*rpc\s+(\w+)", m.group(2), re.M)
    streams = re.findall(
        r"^\s*rpc\s+\w+\s*\(\s*(?:stream\s+)?[\w.]+\s*\)\s*returns\s*\(\s*stream\s+", text, re.M
    )
    messages = re.findall(r"^\s*message\s+\w+\s*\{", text, re.M)
    return {"services": services, "streams": len(streams), "messages": len(messages)}


def stub_rpcs(root: Path, services: dict) -> tuple[list[str], dict]:
    """RPC, чьё тело — заглушка (errNotYetW6 / CodeUnimplemented), и сервисы
    целиком на Unimplemented*Handler."""
    all_rpcs = {r for names in services.values() for r in names}
    stubs = []
    for path in sorted((root / "core" / "internal" / "api").glob("*.go")):
        if path.name.endswith("_test.go"):
            continue
        src = read(path)
        for m in re.finditer(r"^func \([^)]*\) (\w+)\(", src, re.M):
            name = m.group(1)
            if name not in all_rpcs:
                continue
            end = src.find("\n}\n", m.end())
            body = src[m.end() : end if end != -1 else len(src)]
            if "errNotYetW6" in body or "CodeUnimplemented" in body:
                stubs.append(name)
    whole = {}
    server_go = read(root / "core" / "internal" / "api" / "server.go")
    for m in re.finditer(r"lavrayv1connect\.Unimplemented(\w+)Handler\{\}", server_go):
        svc = m.group(1)
        if svc in services:
            whole[svc] = len(services[svc])
    return stubs, whole


def dict_keys(root: Path, lang: str) -> int:
    text = read(root / "ui" / "src" / "lib" / "dictionaries" / f"{lang}.ts")
    return len(re.findall(r'^\s*"([^"]+)":', text, re.M))


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # одинаковый вывод в любой консоли Windows
    root = repo_root()
    files = tracked(root)
    p = proto_stats(root)
    n_rpc = sum(len(v) for v in p["services"].values())
    stubs, whole = stub_rpcs(root, p["services"])
    n_stub = len(stubs) + sum(whole.values())

    screens = [f for f in files if re.fullmatch(r"ui/src/screens/screen_\w+\.tsx", f)]
    golden = [f for f in files if re.fullmatch(r"core/internal/cfgbuild/testdata/golden/\S+\.in\.json", f)]
    presets = [f for f in files if re.fullmatch(r"core/internal/presets/builtin/[\w-]+\.json", f)]
    go_src = [f for f in files if f.endswith(".go") and "/gen/" not in f]
    rs_src = [f for f in files if f.endswith(".rs")]
    ts_src = [f for f in files if f.endswith((".ts", ".tsx")) and "/gen/" not in f]
    fr_ids = set(re.findall(r"FR-UI-(\d{3})", read(root / "docs" / "REQUIREMENTS.md")))

    print("# Факты о репозитории (scripts/repo-stats.py)")
    print()
    print(
        f"- Контракт: сервисов {len(p['services'])}, RPC {n_rpc}, "
        f"серверных потоков {p['streams']}, сообщений {p['messages']}"
    )
    print(f"- RPC-заглушек (unimplemented): {n_stub} из {n_rpc}")
    for svc, n in sorted(whole.items()):
        print(f"    - сервис целиком на заглушке: {svc} ({n} RPC)")
    for name in sorted(stubs):
        print(f"    - метод-заглушка: {name}")
    print(f"- Экраны UI: {len(screens)}")
    print(
        "- Ключи словарей: "
        + ", ".join(f"{lang} {dict_keys(root, lang)}" for lang in ("ru", "en", "zh", "es", "de"))
    )
    print(f"- Golden-конфигурации cfgbuild: {len(golden)}")
    print(f"- Встроенные пресеты: {len(presets)}")
    print(f"- Исходные файлы: Go {len(go_src)} (без gen), Rust {len(rs_src)}, TS/TSX {len(ts_src)} (без gen)")
    print(f"- Требования FR-UI: уникальных номеров {len(fr_ids)}, наибольший {max(fr_ids) if fr_ids else '-'}")
    print()
    print("Числа тестов эта утилита не считает; команды (ожидаемый вывод — в CI):")
    print("- core:  go test ./... -count=1")
    print("- shell: cargo test")
    print("- ui:    npx vitest run")
    return 0


if __name__ == "__main__":
    sys.exit(main())
