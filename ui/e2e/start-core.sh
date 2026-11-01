#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
#
# start-core.sh — ядро для web-e2e: веб-панель на loopback, свежий каталог
# данных, токен ядра первой строкой stdin. stdin держим открытым: EOF для ядра
# означает смерть оболочки и ведёт к выходу.
#
#   LAVRAY_CORE_BIN    путь к lavray-core, собранному с тегом with_webui (../lavray-core)
#   LAVRAY_E2E_PORT    порт панели на 127.0.0.1 (8787)
#   LAVRAY_E2E_TOKEN   токен ядра (общий с web-login.spec.ts)
set -euo pipefail

core="${LAVRAY_CORE_BIN:-../lavray-core}"
port="${LAVRAY_E2E_PORT:-8787}"
token="${LAVRAY_E2E_TOKEN:-e2e-core-token-0123456789abcdef0123456789}"
data="$(mktemp -d)"
trap 'rm -rf "$data"' EXIT

# Держатель stdin: токен, затем ждёт, пока жив этот скрипт (проверка раз в
# секунду). Раньше там был sleep 3600: в Git Bash он переживал ядро и держал
# унаследованный stderr webServer, и Playwright ждал EOF ещё ~10 минут после
# тестов (D-8 прогона 0.9.0). Его stderr теперь в /dev/null, каналов
# Playwright он не держит.
hold_stdin() {
  printf '%s\n' "$token"
  while kill -0 "$1" 2>/dev/null; do sleep 1; done
}

# Подстановка процесса, а не конвейер: когда ядро выходит, скрипт завершается
# сразу (в конвейере он ждал бы держателя).
"$core" serve \
  --listen-socket 127.0.0.1:0 \
  --data "$data" \
  --web-bind "127.0.0.1:${port}" \
  < <(hold_stdin "$$" 2>/dev/null)
