#!/bin/sh
# scripts/check-public-docs.sh — публичные документы не называют стороннего
# клиента (решение владельца 2026-10-23; задача T-48).
#
# Слово собрано из частей, чтобы сам скрипт его не содержал.
# Запуск: sh scripts/check-public-docs.sh (из любого каталога репозитория).
# Код возврата: 0 — упоминаний нет; 1 — найдены (строки выводятся).
#
# Исключения (не правятся, решение владельца): реестр docs/LICENSES.md и
# архив аудита исходного NekoBox (пути его исходников, версия форка,
# анализ конкурентов) — AUDIT.md, BUGS.md, AUDIT-CLAUDE-2026-10.md,
# CLAUDE-AUDIT-PROMPT.md, audit-2026-10/.
set -eu
cd "$(git rev-parse --show-toplevel)"
word="h""app"
if git grep -n -i -e "$word" -- '*.md' \
    ':(exclude)docs/LICENSES.md' \
    ':(exclude)docs/AUDIT.md' \
    ':(exclude)docs/BUGS.md' \
    ':(exclude)docs/AUDIT-CLAUDE-2026-10.md' \
    ':(exclude)docs/CLAUDE-AUDIT-PROMPT.md' \
    ':(exclude)docs/audit-2026-10'; then
  echo "FAIL: найдены упоминания в публичных документах (см. выше)" >&2
  exit 1
fi
echo "ok: упоминаний нет"
