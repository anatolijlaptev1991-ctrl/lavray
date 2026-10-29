#!/usr/bin/env bash
# build.sh — сборка LAVRay (Linux/macOS): UI → ядро → бандл.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OS="$(uname -s)"

echo "== UI"
(cd "$ROOT/ui" && npm ci && npm run build)

echo "== Ядро"
CORE_NAME="lavray-core"
[[ "$OS" == "Darwin" ]] && CORE_NAME="lavray-core"   # универсальный позже через lipo
# Теги сборки — единый список core/BUILD_TAGS (T-02); не копировать в скрипт.
TAGS="$(tr -d '[:space:]' < "$ROOT/core/BUILD_TAGS")"
[[ -n "$TAGS" ]] || { echo "core/BUILD_TAGS пуст" >&2; exit 1; }
(cd "$ROOT/core" && CGO_ENABLED=0 go build -tags "$TAGS" -trimpath -ldflags '-s -w' -o "$ROOT/shell/binaries/lavray-core" ./cmd/lavray-core/)

echo "== Оболочка"
cd "$ROOT/shell"
if [[ "$OS" == "Darwin" ]]; then
  cargo tauri build --bundles dmg,app
else
  cargo tauri build --bundles deb,appimage
fi
echo "== Готово"
