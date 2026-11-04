#!/bin/sh
# scripts/check-readme-claims.sh — README и сопутствующие документы не повторяют
# утверждений, опровергнутых проверкой 0.1.0 (задача T-74).
# Запуск: sh scripts/check-readme-claims.sh (из любого каталога репозитория).
# Код возврата: 0 — запрещённых фраз нет; 1 — найдены (строки выводятся).
# Список ниже пополняется, когда в документах находят очередную неверную фразу.
set -eu
cd "$(git rev-parse --show-toplevel)"
rc=0

# check <файл> <фиксированная строка> <что не так>
check() {
  if git grep -n -F -e "$2" -- "$1"; then
    echo "FAIL: $1: $3" >&2
    rc=1
  fi
}

check README.md 'работает end-to-end' 'статус без оговорок о недоделанных функциях'
check README.md 'Все пять разделов' 'экранов десять, часть функций не готова'
check README.md '5 боевых экранов' 'экранов десять'
check README.md '765 ключей' 'число ключей словарей считает scripts/repo-stats.py'
check README.md 'Windows (NSIS/MSI)' 'MSI не выпускается'
check README.md 'ipk + LuCI + веб-панель' 'пакетов OpenWrt и веб-панели нет'
check README.md 'активация на лету' 'набор маршрутов применяется при переподключении'
check README.md 'minisign + sha256 из подписанного манифеста' 'подписанных манифестов нет'
check README.md '17 пакетов тестов' 'числа тестов в README не пишем'
check README.md '56 тестов' 'числа тестов в README не пишем'
check README.md 'Node 22' 'в CI используется Node 24'
check README.md 'Rust 1.80' 'проверено на Rust 1.96 (stable)'
check README.md 'фаззинг 2М+' 'число запусков фаззера не проверяемо'
check README.md 'FSM, авторестарт' 'авторестарт есть только в internal/headless'
check README.md 'diff-флоу' 'diff-экрана обновления подписки нет'
check README.md 'PBKDF2-вход' 'веб-панель не подключена к ядру'
check README.md 'Секреты не попадают в логи' 'у logs.Redact есть пропуски; пишем «маскируются»'
check README.md 'порог 2-из-3, ротация' 'порог ключей сейчас 1, «2-из-3» — следующая фаза'
# Занижения: функция уже вышла, а документ называет её недоделанной (найдено ревью 2026-11-04).
check README.md 'не подключена к ядру' 'клиент обновлений подключён с 0.5.0'
check README.md 'экспортируются только настройки' 'зашифрованная копия .lavbk с 0.7.0'
check README.md 'часть RPC — заглушки' 'заглушек нет, кроме WebSessionService без --web-bind'
check README.md 'импорт по QR-коду и перенос' 'QR с 0.4.0, перенос из NekoBox с 0.6.0'
check core/README.md 'в приложении не подключён' 'перенос из NekoBox подключён (MigrationService)'
check core/README.md 'в ядро пока не подключён' 'клиент обновлений подключён с 0.5.0'
check shell/README.md 'к рантайму пока не подключены' 'трей и автомат обновлений подключены'
check proto/README.md 'WebAdminService' 'такого сервиса нет: WebSessionService'
check proto/README.md 'GroupService' 'такого сервиса нет: группы в ProfileService'
check proto/README.md '85 RPC' 'числа RPC считает scripts/repo-stats.py'
check core/README.md 'Структура (целевая)' 'описана фактическая структура'
check core/README.md 'internal/config/' 'каталога нет: internal/cfgbuild'
check docs/RELEASE-NOTES-windows-v0.1.0.md 'подписки, QR, экспорт' 'QR-импорта нет'
check shell/README.md 'интеграция с Tauri updater' 'обновления свои (src/update), не Tauri updater'
check shell/README.md 'при появлении `../ui`' 'frontendDist уже ../ui/dist'
check ui/README.md '32 экрана' 'скриншотов 23'

if [ "$rc" -eq 0 ]; then
  echo "ok: запрещённых фраз нет"
fi
exit "$rc"
