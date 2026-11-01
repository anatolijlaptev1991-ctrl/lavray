#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
#
# build-webui.sh — собирает ui/dist и кладёт его в core/internal/web/dist, откуда
# сборка ядра с тегом with_webui встраивает панель в бинарник:
#
#   bash scripts/build-webui.sh            # npm ci + сборка + копирование
#   bash scripts/build-webui.sh --no-install   # зависимости уже стоят (CI после npm ci)
#   bash scripts/build-webui.sh --no-build     # ui/dist уже собран
#   (cd core && go build -tags with_webui ./cmd/lavray-core)
#
# В каталоге dist в репозитории хранится только .gitkeep, остальное в .gitignore.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install=1
build=1
for arg in "$@"; do
  case "$arg" in
    --no-install) install=0 ;;
    --no-build) build=0 ;;
    *) echo "build-webui.sh: неизвестный аргумент: $arg" >&2; exit 2 ;;
  esac
done

if [ "$build" = 1 ]; then
  cd "$root/ui"
  if [ "$install" = 1 ]; then npm ci; fi
  npm run build
fi

src="$root/ui/dist"
dest="$root/core/internal/web/dist"
if [ ! -f "$src/index.html" ]; then
  echo "build-webui.sh: нет $src/index.html — сначала соберите интерфейс" >&2
  exit 1
fi
mkdir -p "$dest"
# Прежнее содержимое убираем целиком, кроме .gitkeep: старые хэшированные
# файлы не должны попасть в бинарник.
find "$dest" -mindepth 1 -not -name .gitkeep -delete
cp -R "$src"/. "$dest"/
echo "build-webui.sh: $(find "$dest" -type f -not -name .gitkeep | wc -l) файлов в $dest"
