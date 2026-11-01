#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Защита от «RPC есть в ядре, а интерфейс про него не знает» (хвосты B, 7.1).

    python scripts/rpc_usage.py            # проверка; код 1 при нарушении
    python scripts/rpc_usage.py --list     # напечатать RPC без вызова в ui/src

Каждый RPC из proto/lavray.proto должен либо вызываться в ui/src, либо стоять в
ui/src/rpc-unused.allow.ts с причиной. «Вызывается» значит `<клиент>.<метод>(` в
исходниках интерфейса без тестов и сгенерированного кода: `core.profiles.moveProfiles(`.
Клиент выбирается по сервису (ProfileService -> profiles), поэтому одноимённые
Subscribe у LogService и StatsService различаются.

Список разрешённых только уменьшается: запись про RPC, который уже вызывается или
исчез из proto, тоже нарушение (устаревшее исключение скрывало бы регресс). Тот же
контракт проверяет ui/src/rpc-usage.test.ts. Только стандартная библиотека.
"""
import argparse
import re
import sys
from pathlib import Path

PROTO = "proto/lavray.proto"
ALLOW = "ui/src/rpc-unused.allow.ts"
SRC = "ui/src"

# Сервис -> поле клиента в CoreClients (ui/src/lib/core.ts). Сервисы без клиента
# (шлюз, веб-сессии) в интерфейсе окна не вызываются и стоят в списке разрешённых.
CLIENT_BY_SERVICE = {
    "CoreService": "core",
    "ProfileService": "profiles",
    "SubscriptionService": "subscriptions",
    "RoutingService": "routing",
    "DnsService": "dns",
    "SettingsService": "settings",
    "LogService": "logs",
    "StatsService": "stats",
    "ConnectionService": "connections",
    "DiagnosticsService": "diagnostics",
    "UpdateService": "updates",
    "BackupService": "backup",
}

SERVICE_RE = re.compile(r"^service\s+(\w+)\s*\{", re.M)
RPC_RE = re.compile(r"^\s*rpc\s+(\w+)\s*\(", re.M)
ALLOW_RE = re.compile(r"^\s*'(\w+/\w+)':\s*(?:\n\s*)?(['\"`])(.*?)\2\s*,?\s*$", re.M)


def rpcs(proto_text: str) -> list[str]:
    """Все RPC в виде «Сервис/Метод», по порядку файла."""
    out = []
    services = list(SERVICE_RE.finditer(proto_text))
    for i, svc in enumerate(services):
        end = services[i + 1].start() if i + 1 < len(services) else len(proto_text)
        out.extend(f"{svc.group(1)}/{m.group(1)}" for m in RPC_RE.finditer(proto_text, svc.end(), end))
    return out


def is_ui_source(rel: str) -> bool:
    """Исходник интерфейса, в котором вызов считается: без тестов, gen и списка разрешённых."""
    if not rel.endswith((".ts", ".tsx")) or rel.endswith((".test.ts", ".test.tsx", ".d.ts")):
        return False
    return not rel.startswith(("gen/", "test-utils/")) and rel not in ("rpc-unused.allow.ts", "test-harness.ts", "test-setup.ts")


def ui_sources(root: Path) -> str:
    src = root / SRC
    parts = []
    for path in sorted(src.rglob("*")):
        rel = path.relative_to(src).as_posix()
        if path.is_file() and is_ui_source(rel):
            parts.append(path.read_text(encoding="utf-8"))
    return "\n".join(parts)


def is_called(rpc: str, sources: str) -> bool:
    """Есть ли в исходниках `<клиент>.<метод>(` для RPC «Сервис/Метод»."""
    service, method = rpc.split("/")
    client = CLIENT_BY_SERVICE.get(service)
    if client is None:
        return False
    name = method[0].lower() + method[1:]
    return re.search(rf"(?<![\w.]){client}\s*\.\s*{name}\s*\(|\.{client}\s*\.\s*{name}\s*\(", sources) is not None


def allowed(root: Path) -> dict[str, str]:
    """RPC из ui/src/rpc-unused.allow.ts -> причина."""
    text = (root / ALLOW).read_text(encoding="utf-8")
    return {m.group(1): m.group(3) for m in ALLOW_RE.finditer(text)}


def problems(root: Path) -> list[str]:
    proto = rpcs((root / PROTO).read_text(encoding="utf-8"))
    sources = ui_sources(root)
    allow = allowed(root)
    out = []
    for rpc in proto:
        called = is_called(rpc, sources)
        if not called and rpc not in allow:
            out.append(f"{rpc}: не вызывается в ui/src и не внесён в {ALLOW} (с причиной)")
        if called and rpc in allow:
            out.append(f"{rpc}: вызывается в ui/src, запись в {ALLOW} устарела — удалите её")
    for rpc, reason in allow.items():
        if rpc not in proto:
            out.append(f"{rpc}: записан в {ALLOW}, но в proto такого RPC нет")
        if len(reason.strip()) < 10:
            out.append(f"{rpc}: в {ALLOW} нет внятной причины")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", default=".", help="корень репозитория")
    parser.add_argument("--list", action="store_true", help="напечатать RPC без вызова в ui/src")
    args = parser.parse_args(argv)
    root = Path(args.root)
    if args.list:
        sources = ui_sources(root)
        for rpc in rpcs((root / PROTO).read_text(encoding="utf-8")):
            if not is_called(rpc, sources):
                print(rpc)
        return 0
    found = problems(root)
    for line in found:
        print(f"нарушение: {line}")
    total = len(rpcs((root / PROTO).read_text(encoding="utf-8")))
    print(f"rpc_usage: RPC в proto: {total}, нарушений: {len(found)}")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
