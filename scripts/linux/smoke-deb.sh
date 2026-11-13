#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
#
# smoke-deb.sh — проверка установки deb в чистом Ubuntu-контейнере.
# Запуск (от root, внутри контейнера): smoke-deb.sh /dist/lavray-<версия>-linux-amd64.deb
# CI монтирует dist/ и scripts/linux/ в контейнер (см. .github/workflows/linux-desktop.yml).
set -euo pipefail

# Аргумент может быть маской (/dist/lavray-*-linux-amd64.deb): раскрываем здесь.
DEB="$(compgen -G "${1:?укажите путь к deb}" | sed -n 1p)"
[ -n "$DEB" ] || { echo "FAIL: deb не найден по маске $1" >&2; exit 1; }
CORE=/usr/lib/LAVRay/binaries/lavray-core
DESKTOP=/usr/share/applications/LAVRay.desktop

fail() { echo "FAIL: $*" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends "$DEB" desktop-file-utils 2>&1

# Бинарь и ядро на месте и ИСПОЛНЯЕМЫЕ (test -x, не -f).
test -x /usr/bin/LAVRay || fail "/usr/bin/LAVRay не исполняем"
test -x "$CORE" || fail "ядро не исполняемо"

# postinst выдал ядру cap_net_admin и ничего лишнего (формат getcap зависит от версии libcap).
caps="$(getcap "$CORE")"
echo "getcap: $caps"
echo "$caps" | grep -q cap_net_admin || fail "у ядра нет cap_net_admin"
if echo "$caps" | grep -q cap_net_bind_service; then fail "у ядра лишняя cap_net_bind_service"; fi

# Desktop-файл: валиден по спецификации, нужные поля на месте.
# Имя файла задаёт сборщик: если оно иное, берём то, что реально поставил пакет.
if [ ! -f "$DESKTOP" ]; then
  DESKTOP="$(dpkg -L lav-ray | grep -E '^/usr/share/applications/[^/]+\.desktop$' | head -n 1)"
fi
[ -n "$DESKTOP" ] && [ -f "$DESKTOP" ] || fail "пакет не поставил desktop-файл"
echo "desktop-файл: $DESKTOP"
desktop-file-validate "$DESKTOP"
grep -q '^Exec=LAVRay' "$DESKTOP" || fail "Exec"
grep -q '^Categories=Network;' "$DESKTOP" || fail "Categories"
grep -q '^Keywords=' "$DESKTOP" || fail "Keywords"
grep -q '^StartupWMClass=LAVRay' "$DESKTOP" || fail "StartupWMClass"
grep -q '^Comment\[ru\]=' "$DESKTOP" || fail "Comment[ru]"
icon_name="$(sed -n 's/^Icon=//p' "$DESKTOP")"
find /usr/share/icons/hicolor -name "$icon_name.png" | grep -q . \
  || fail "нет иконки $icon_name в hicolor"

# Зависимости: без дублей, есть libcap2-bin.
deps="$(dpkg-query -W -f='${Depends}' lav-ray)"
echo "Depends: $deps"
dups="$(echo "$deps" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | sort | uniq -d)"
[ -z "$dups" ] || fail "дубли в Depends: $dups"
echo "$deps" | grep -q libcap2-bin || fail "нет libcap2-bin в Depends"
# Эти три пакета добавляет сам сборщик Tauri; без них окно и значок в трее не откроются.
for dep in libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1; do
  echo "$deps" | grep -q "$dep" || fail "нет $dep в Depends"
done

# Ядро запускается: без аргументов печатает справку и выходит с кодом 2
# (подкоманд, меняющих состояние системы, не вызываем).
set +e
usage="$("$CORE" 2>&1)"
rc=$?
set -e
echo "$usage"
[ "$rc" -eq 2 ] || fail "lavray-core без аргументов: ожидался код 2, получен $rc"
echo "$usage" | grep -q 'lavray-core serve' || fail "в справке ядра нет 'lavray-core serve'"

# Повторная установка поверх (обновление) не теряет права.
apt-get install -y --reinstall --no-install-recommends "$DEB" 2>&1
getcap "$CORE" | grep -q cap_net_admin || fail "после переустановки пропали capabilities"

# Удаление проходит без ошибок и убирает файлы.
apt-get remove -y lav-ray 2>&1
test ! -e /usr/bin/LAVRay || fail "после удаления остался /usr/bin/LAVRay"
test ! -e "$DESKTOP" || fail "после удаления остался desktop-файл"
apt-get purge -y lav-ray 2>&1

echo "Smoke OK: deb установлен, права TUN выданы, desktop валиден, удаление чистое"
