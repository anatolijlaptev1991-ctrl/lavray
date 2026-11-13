#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
#
# build-packages.sh — сборка deb и AppImage LAVRay для Linux из ТЕКУЩЕГО
# checkout (репозиторий не клонируется). Запускается в CI
# (.github/workflows/linux-desktop.yml) на ubuntu-24.04; Go, Node и Rust
# ставит workflow, системные пакеты Tauri — тоже он.
#
# Переменные:
#   BUNDLES          сборочные цели Tauri (по умолчанию "deb,appimage")
#   SKIP_UI_BUILD=1  использовать уже собранный ui/dist (для отладки)
#   LAVRAY_COMMIT    SHA для dist/lavray-commit.txt (по умолчанию git HEAD;
#                    в pull_request HEAD — merge-коммит, поэтому workflow
#                    передаёт SHA головы PR)
#
# Результат: dist/ с lavray-<версия>-linux-amd64.deb,
# LAVRay-<версия>-x86_64.AppImage, SHA256SUMS-linux-desktop.txt и
# lavray-commit.txt; work/ — временные файлы.
#
# Ядро собирается как в release-windows.yml: CGO-free, теги из
# core/BUILD_TAGS, версия вшивается компоновщиком. Десктопу with_webui не
# нужен — интерфейс встроен в оболочку (Tauri).

set -euo pipefail

cd "$(dirname "$0")/../.."
REPO_ROOT="$(pwd)"
BUNDLES="${BUNDLES:-deb,appimage}"

WORK="$REPO_ROOT/work"
DIST="$REPO_ROOT/dist"
rm -rf "$WORK" "$DIST"
mkdir -p "$WORK" "$DIST"

LAVRAY_SHA="${LAVRAY_COMMIT:-$(git rev-parse HEAD)}"
echo "Коммит: $LAVRAY_SHA"
echo "$LAVRAY_SHA" > "$DIST/lavray-commit.txt"

VERSION="$(python3 -c "import json;print(json.load(open('shell/tauri.conf.json', encoding='utf-8'))['version'])")"
echo "Версия: $VERSION"

if [ "${SKIP_UI_BUILD:-0}" != "1" ]; then
  echo "=== Интерфейс (ui/dist для frontendDist) ==="
  (cd ui && npm ci --silent && npm run build)
fi

echo "=== Ядро lavray-core (linux/amd64) ==="
# Как в release-windows.yml: форк sing-box берётся напрямую (GOPRIVATE), go mod
# tidy подтягивает зависимости форка.
export GOPRIVATE='github.com/anatolijlaptev1991-ctrl/*'
export GOFLAGS='-mod=mod'
CORE_DIR="$REPO_ROOT/core"
# Валидность списка тегов проверяет тест (T-02/T-47).
(cd "$CORE_DIR" && go test ./internal/buildtags/ -count=1)
# Теги ядра — единый список core/BUILD_TAGS (T-02/T-47: не копировать сюда).
tags="$(tr -d '[:space:]' < "$CORE_DIR/BUILD_TAGS")"
if [ -z "$tags" ]; then
  echo "::error::core/BUILD_TAGS пуст"
  exit 1
fi
ld="-s -w -X github.com/anatolijlaptev1991-ctrl/lavray/core/internal/version.Version=$VERSION"
mkdir -p shell/binaries
(cd "$CORE_DIR" && go mod tidy && CGO_ENABLED=0 GOOS=linux GOARCH=amd64   go build -tags "$tags" -trimpath -ldflags "$ld"   -o ../shell/binaries/lavray-core ./cmd/lavray-core/)
chmod +x shell/binaries/lavray-core
go version -m shell/binaries/lavray-core | grep -q -- "-tags=$tags"   || { echo "::error::в lavray-core нет тегов $tags"; exit 1; }

# changelog.gz для deb (lintian no-changelog).
gzip -9nc shell/packaging/changelog > shell/packaging/changelog.gz

echo "=== Оболочка: cargo tauri build --bundles $BUNDLES ==="
if ! command -v cargo-tauri >/dev/null 2>&1; then
  # Пин точной версией: сборка воспроизводима от прогона к прогону.
  cargo install tauri-cli --version 2.12.4 --locked
fi
# --locked: Cargo.lock обязан совпадать с Cargo.toml.
(cd shell && cargo build --locked --release && cargo tauri build --bundles "$BUNDLES")

echo "=== Артефакты ==="
DEB="$(find shell/target/release/bundle/deb -name '*.deb' -print | sed -n '1p')"
APP="$(find shell/target/release/bundle/appimage -name '*.AppImage' -print | sed -n '1p')"
if [ -z "$DEB" ]; then echo "::error::deb не собран"; exit 1; fi
if [ -z "$APP" ]; then echo "::error::AppImage не собран"; exit 1; fi
cp "$DEB" "$DIST/lavray-$VERSION-linux-amd64.deb"
cp "$APP" "$DIST/LAVRay-$VERSION-x86_64.AppImage"

echo "=== Контроль содержимого deb ==="
dpkg-deb -I "$DIST/lavray-$VERSION-linux-amd64.deb" | awk 'NR<=8'
DEB_LIST="$(dpkg-deb -c "$DIST/lavray-$VERSION-linux-amd64.deb")"
for pattern in "bin/LAVRay" "lib/LAVRay/binaries/lavray-core" "applications/" "/icons/"; do
  echo "$DEB_LIST" | grep -q "$pattern" \
    || { echo "::error::в deb нет пути: $pattern"; exit 1; }
done
# bundler пишет Depends только из конфига: без них на чистой системе не будет
# libwebkit2gtk и окно не откроется. CI обязан это ловить.
dpkg-deb -f "$DIST/lavray-$VERSION-linux-amd64.deb" Depends | grep -q libwebkit2gtk-4.1-0 \
  || { echo "::error::в deb нет зависимости libwebkit2gtk-4.1-0"; exit 1; }

# Права TUN: postinst выдаёт ядру capabilities через setcap (libcap2-bin).
DEB_FILE="$DIST/lavray-$VERSION-linux-amd64.deb"
dpkg-deb -f "$DEB_FILE" Depends | grep -q libcap2-bin   || { echo "::error::в deb нет зависимости libcap2-bin (нужна postinst)"; exit 1; }
# Дубли в Depends: Tauri сам добавляет webkit/gtk/appindicator.
dup="$(dpkg-deb -f "$DEB_FILE" Depends | tr ',' '
' | sed 's/^ *//;s/ *$//' | sort | uniq -d)"
if [ -n "$dup" ]; then
  echo "::error::дубли в Depends: $dup"
  exit 1
fi
CTRL_DIR="$WORK/deb-control"
rm -rf "$CTRL_DIR"
dpkg-deb -e "$DEB_FILE" "$CTRL_DIR"
if [ ! -x "$CTRL_DIR/postinst" ]; then
  echo "::error::в deb нет исполняемого postinst (проверьте bundle.linux.deb.postInstallScript)"
  exit 1
fi
sh -n "$CTRL_DIR/postinst" || { echo "::error::postinst не проходит sh -n"; exit 1; }
grep -q 'cap_net_admin+ep' "$CTRL_DIR/postinst" || { echo "::error::postinst не выдаёт ядру cap_net_admin"; exit 1; }
# Лишних прав быть не должно: ядру для TUN нужен только cap_net_admin.
if grep -q 'cap_net_bind_service' "$CTRL_DIR/postinst"; then echo "::error::postinst выдаёт лишнюю cap_net_bind_service"; exit 1; fi
# Свой шаблон desktop-файла применился (Categories=Network, а не Utility).
# Имена в архиве данных зависят от сборщика (с "./" или без), поэтому пакет
# распаковывается во временный каталог, а файл ищется по расширению.
DEB_ROOT="$WORK/deb-root"
rm -rf "$DEB_ROOT"
mkdir -p "$DEB_ROOT"
dpkg-deb -x "$DEB_FILE" "$DEB_ROOT"
DESKTOP_FILE="$(find "$DEB_ROOT/usr/share/applications" -maxdepth 1 -name '*.desktop' 2>/dev/null | head -n 1)"
if [ -z "$DESKTOP_FILE" ]; then
  echo "::error::в deb нет desktop-файла в usr/share/applications"
  dpkg-deb -c "$DEB_FILE" | grep -i -E 'applications|desktop' || true
  exit 1
fi
echo "desktop-файл: ${DESKTOP_FILE#"$DEB_ROOT"}"
DESKTOP_TXT="$(cat "$DESKTOP_FILE")"
echo "$DESKTOP_TXT" | grep -q '^Categories=Network;'   || { echo "::error::desktop-файл без Categories=Network (шаблон не применился)"; exit 1; }
echo "$DESKTOP_TXT" | grep -q '^StartupWMClass=LAVRay'   || { echo "::error::в desktop-файле нет StartupWMClass=LAVRay"; exit 1; }

echo "=== Контроль AppImage (распаковка) ==="
chmod +x "$DIST/LAVRay-$VERSION-x86_64.AppImage"
# Прошлая распаковка не должна маскировать проверки текущего файла.
rm -rf squashfs-root
"$DIST/LAVRay-$VERSION-x86_64.AppImage" --appimage-extract >/dev/null
# Исполняемость (test -x), а не только наличие: потерянный +x ломает запуск.
if [ ! -x squashfs-root/usr/bin/LAVRay ]; then
  echo "::error::в AppImage нет исполняемого usr/bin/LAVRay"
  exit 1
fi
if [ ! -x squashfs-root/usr/lib/LAVRay/binaries/lavray-core ]; then
  echo "::error::в AppImage нет исполняемого usr/lib/LAVRay/binaries/lavray-core"
  exit 1
fi
rm -rf squashfs-root

echo "=== SHA256 ==="
(
  cd "$DIST" \
    && sha256sum "lavray-$VERSION-linux-amd64.deb" "LAVRay-$VERSION-x86_64.AppImage" \
      > SHA256SUMS-linux-desktop.txt \
    && cat SHA256SUMS-linux-desktop.txt
)

echo "Готово: dist/ — deb, AppImage, SHA256SUMS-linux-desktop.txt (коммит $LAVRAY_SHA)"
