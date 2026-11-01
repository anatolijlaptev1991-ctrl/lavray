# A04. Rust-оболочка: fmt, clippy, тесты, настоящий WinINET на выдуманной записи

| Поле | Значение |
|---|---|
| ID | A04 |
| Слой | авто |
| Время | 15–30 минут на свежем ПК (первая сборка дерева Tauri), 3–5 минут с тёплым кэшем |
| Зависимости | `01-ENVIRONMENT.md`, разделы 3–6 (страж, маркер `TESTPC_OK`). Выполняется последовательно с A10, A11 и M-файлами (см. `00-README.md`, группа S) |
| Опасность | реестр: один шаг (7–8) выполняет настоящие вызовы WinINET на **выдуманной** записи RAS и пишет значение в `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings\Connections`. Файл сам возвращает прежнее состояние и проверяет это |

## Цель

Выполнить задания `rust` и `rust-windows` CI на тестовом ПК: форматирование, clippy без предупреждений, все тесты оболочки, а на Windows ещё и тест `wininet_roundtrip_on_fake_ras_name` с настоящим WinINET (`LAVRAY_CI_REAL_WININET=1`). Покрывает эпик T-82 (остаток, Ф2): прокси LAN и записей RAS, снимок и откат, WPAD, автозапуск (на подставной ОС), горячая клавиша, уведомления, «Сохранить как» через диалог (путь выбирает только пользователь), поведение окна и трея (чистые решения), а также T-77 (захват экрана `capture`, на подставке). Что здесь **не** проверяется: поведение на живой системе (файл A11) и работа окна (файлы M).

## Предусловия

- **Тестовый ПК подтверждён**: существует `C:\lavray-test\TESTPC_OK` (раздел 3 файла `01-ENVIRONMENT.md`). Без маркера файл завершается итогом `BLOCKED`.
- Rust stable с `rustfmt` и `clippy`, Visual Studio Build Tools с рабочей нагрузкой C++, Node 24, Git (`01-ENVIRONMENT.md`, раздел 5).
- Сеть: `index.crates.io`, `static.crates.io`, `registry.npmjs.org`.
- 6–10 ГБ свободного места под `target\`.
- Нужен собранный интерфейс (`ui\dist`): `tauri::generate_context!` читает его на этапе компиляции. Шаг 2 строит его в рабочей копии.
- Новые крейты и обновление `Cargo.lock` запрещены: файл не запускает `cargo update` и проверяет, что `Cargo.lock` не изменился.

## Безопасность

Единственная запись в систему — шаг 7–8: тест вызывает `InternetSetOptionW` с `INTERNET_OPTION_PER_CONNECTION_OPTION` для имени `LAVRay CI fake RAS entry` (имени нет в телефонной книге RAS, настоящие подключения не затрагиваются) и сразу возвращает прежние настройки. Побочный эффект: WinINET может создать значение `LAVRay CI fake RAS entry` в разделе `Connections`. Файл снимает состояние раздела до теста (шаг 6), после теста сравнивает (шаг 9) и удаляет это значение, если его не было. Общий системный прокси LAN (`ProxyEnable`, `ProxyServer`, `DefaultConnectionSettings`) тест не меняет; шаг 9 это проверяет.

Не запускайте шаги 7–8 на ПК, где работает чужой VPN: это правило CI («на ПК разработчика — никогда»). Страж из `01-ENVIRONMENT.md` это отсекает.

## Шаги

1. Страж и рабочая копия.

```powershell
. C:\lavray-test\env.ps1
if (-not (Test-Path C:\lavray-test\TESTPC_OK)) { 'BLOCKED: нет маркера TESTPC_OK'; return }
$wt = Join-Path $env:LAVRAY_TP_ROOT 'wt\A04'
git -C $env:LAVRAY_SRC worktree add --detach $wt $env:LAVRAY_REF
Set-Location $wt
git rev-parse HEAD
```

   Ожидается: маркер найден, печатается коммит.

2. Сборка интерфейса (нужна для `frontendDist`).

```powershell
Set-Location (Join-Path $wt 'ui')
npm ci
"npm ci exit=$LASTEXITCODE"
npm run build
"ui build exit=$LASTEXITCODE"
Test-Path (Join-Path $wt 'ui\dist\index.html')
```

   Ожидается: оба кода `0`, `True`. (`npm run build` выполняет `tsc --noEmit && vite build`.)

3. Форматирование.

```powershell
Set-Location (Join-Path $wt 'shell')
cargo fmt --all -- --check
"fmt exit=$LASTEXITCODE"
```

   Ожидается: `fmt exit=0`, вывода нет.

4. Clippy.

```powershell
cargo clippy --all-targets -- -D warnings 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A04-clippy.txt | Select-Object -Last 5
"clippy exit=$LASTEXITCODE"
```

   Ожидается: `clippy exit=0`, последняя строка `Finished`. Первая сборка долгая (скачивание и компиляция дерева Tauri).

5. Все тесты без разрешения на настоящий WinINET (как задание `rust`).

```powershell
Remove-Item Env:LAVRAY_CI_REAL_WININET -ErrorAction SilentlyContinue
cargo test 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A04-test-default.txt | Select-String -Pattern '^(test result|error|FAILED|failures:)'
"test exit=$LASTEXITCODE"
```

   Ожидается: `test exit=0`; каждая строка `test result:` начинается с `test result: ok.` и содержит `0 failed`; строк `FAILED` и `error` нет.

6. Снимок раздела `Connections` и общих значений прокси **до** настоящего теста.

```powershell
$is   = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$conn = Join-Path $is 'Connections'
function Get-ConnState {
  $props = Get-ItemProperty -Path $conn -ErrorAction SilentlyContinue
  $names = @()
  if ($props) { $names = @($props.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | Select-Object -ExpandProperty Name | Sort-Object) }
  $blob = if ($props -and $props.DefaultConnectionSettings) { (Get-FileHash -InputStream ([IO.MemoryStream]::new([byte[]]$props.DefaultConnectionSettings)) -Algorithm SHA256).Hash } else { '' }
  $main = Get-ItemProperty -Path $is
  [pscustomobject]@{
    Names = ($names -join '|'); DefaultBlobSha256 = $blob
    ProxyEnable = "$($main.ProxyEnable)"; ProxyServer = "$($main.ProxyServer)"
    ProxyOverride = "$($main.ProxyOverride)"; AutoConfigURL = "$($main.AutoConfigURL)"
  }
}
$before = Get-ConnState
$before | ConvertTo-Json | Set-Content C:\lavray-test\tmp\A04-before.json -Encoding utf8
$before | Format-List
```

   Ожидается: печатается состояние; `Names` содержит как минимум `DefaultConnectionSettings` и `SavedLegacySettings` (на «чистой» Windows), значения `ProxyEnable` пусты или `0`. Если `ProxyEnable` равно `1`, страж не должен был пропустить машину: остановитесь с `BLOCKED`.

7. Настоящий WinINET: весь набор, как в CI на Windows (`cargo test` с `LAVRAY_CI_REAL_WININET=1`).

```powershell
$env:LAVRAY_CI_REAL_WININET = '1'
cargo test 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A04-test-real-wininet.txt | Select-String -Pattern '^(test result|error|FAILED|failures:)'
"real-wininet exit=$LASTEXITCODE"
Remove-Item Env:LAVRAY_CI_REAL_WININET
```

   Ожидается: `real-wininet exit=0`, все строки `test result: ok.`. Переменная убирается сразу после команды.

8. Убедиться, что настоящий тест не был пропущен (без этого шаг 7 мог пройти «вхолостую»).

```powershell
$env:LAVRAY_CI_REAL_WININET = '1'
cargo test wininet_roundtrip_on_fake_ras_name -- --nocapture 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A04-test-wininet-only.txt | Select-String -Pattern '(пропущен|test sysproxy|test result|wininet_roundtrip)'
Remove-Item Env:LAVRAY_CI_REAL_WININET
```

   Ожидается: строка `wininet_roundtrip_on_fake_ras_name ... ok`, строка `test result: ok. 1 passed`, и **нет** строки `пропущен: LAVRAY_CI_REAL_WININET не равна 1`. Наличие этой строки — `FAIL` шага (тест пропущен, переменная не дошла).

9. Состояние **после**: сравнение и уборка.

```powershell
$after = Get-ConnState
$after | Format-List
"Names одинаковы:        " + ($before.Names -eq $after.Names)
"DefaultConnection то же: " + ($before.DefaultBlobSha256 -eq $after.DefaultBlobSha256)
"ProxyEnable то же:      " + ($before.ProxyEnable -eq $after.ProxyEnable)
"ProxyServer то же:      " + ($before.ProxyServer -eq $after.ProxyServer)
"ProxyOverride то же:    " + ($before.ProxyOverride -eq $after.ProxyOverride)
"AutoConfigURL то же:    " + ($before.AutoConfigURL -eq $after.AutoConfigURL)
$fake = 'LAVRay CI fake RAS entry'
if ((Get-ItemProperty -Path $conn -ErrorAction SilentlyContinue).PSObject.Properties.Name -contains $fake) {
  Remove-ItemProperty -Path $conn -Name $fake
  "значение '$fake' удалено"
}
$final = Get-ConnState
"Names после уборки = до: " + ($before.Names -eq $final.Names)
```

   Ожидается: все строки `True` после уборки. До уборки допустимо `Names одинаковы: False`, если ровно на значение `LAVRay CI fake RAS entry` больше; это нужно записать в отчёт. Расхождение `DefaultConnection`, `ProxyEnable`, `ProxyServer`, `ProxyOverride` или `AutoConfigURL` — `FAIL` с серьёзностью `major`, и обязателен откат из раздела «Откат».

10. Права окна (capabilities) и проводка команд — отдельные тесты оболочки, запускаются явно, чтобы видеть их имена.

```powershell
cargo test --test capabilities --test main_wiring --test config_lint -- --list 2>&1 | Select-String -Pattern ': test$' | ForEach-Object { $_.Line.Trim() }
cargo test --test capabilities --test main_wiring --test config_lint 2>&1 | Select-String -Pattern '^test result'
```

    Ожидается: в списке есть `capabilities_contain_only_the_permissions_the_ui_uses`, `the_page_cannot_roll_the_system_proxy_back`, `opener_plugin_is_registered_and_limited_to_http_and_https`, `main_window_is_created_by_code_hidden_and_shown_unless_tray`, `nsis_uninstall_hook_removes_autostart_but_not_on_update`; три строки `test result: ok.`. Содержимое `capabilities\default.json` не должно содержать `dialog:`, `fs:`, `notification:`:

```powershell
Select-String -Path (Join-Path $wt 'shell\capabilities\default.json') -Pattern '"(dialog|fs|notification|global-shortcut):' -Quiet
```

    Ожидается `False` (JS-права этих плагинов не выдаются: вызов только из Rust-команд).

11. `Cargo.lock` не менялся, сборка отладочная проходит (задание `cargo build`).

```powershell
git -C $wt diff --stat -- shell/Cargo.lock shell/Cargo.toml
cargo build
"build exit=$LASTEXITCODE"
```

    Ожидается: `git diff --stat` пуст, `build exit=0`.

12. Число тестов (запись эталона для следующих прогонов).

```powershell
$sum = 0
Get-Content C:\lavray-test\results\A04-test-default.txt | ForEach-Object {
  if ($_ -match 'test result: ok\. (\d+) passed') { $sum += [int]$Matches[1] }
}
"passed всего: $sum"
Set-Location (Join-Path $wt 'shell')
(Get-ChildItem -Path src, tests -Recurse -Include *.rs | Select-String -Pattern '#\[test\]' | Measure-Object).Count
```

    Ориентир: число `#[test]` в исходниках на `97624d6` равно 308. Часть тестов компилируется только под Windows или только под Unix, поэтому сумма `passed` обычно близка к 308, но точное эталонное число в плане не зафиксировано (при написании плана полный `cargo test` не запускался). Критерий: сумма `passed` от 90 до 115 % числа `#[test]`; точное значение запишите в отчёт.

## Критерии PASS/FAIL

| № | Критерий | Как проверить |
|---|---|---|
| К1 | Маркер `TESTPC_OK` есть | шаг 1 |
| К2 | UI собран (`ui\dist\index.html` существует) | шаг 2 |
| К3 | `cargo fmt --all -- --check` вернул 0 | `fmt exit=0` |
| К4 | `cargo clippy --all-targets -- -D warnings` вернул 0 | `clippy exit=0` |
| К5 | `cargo test` без разрешения вернул 0, у каждого `test result:` `0 failed` | шаг 5 |
| К6 | `cargo test` с `LAVRAY_CI_REAL_WININET=1` вернул 0 | шаг 7 |
| К7 | Настоящий тест не пропущен: `wininet_roundtrip_on_fake_ras_name ... ok`, строки `пропущен` нет | шаг 8 |
| К8 | После уборки состояние `Connections` и общие значения прокси равны исходным | шаг 9, все `True` |
| К9 | Пять защитных тестов оболочки есть и проходят; в `capabilities` нет `dialog:`, `fs:`, `notification:` | шаг 10 |
| К10 | `Cargo.lock` и `Cargo.toml` не изменены, `cargo build` вернул 0 | шаг 11 |
| К11 | Сумма `passed` в пределах 90–115 % от числа `#[test]` | шаг 12 |

## Что собрать

В `results\A04\`: `A04-clippy.txt`, `A04-test-default.txt`, `A04-test-real-wininet.txt`, `A04-test-wininet-only.txt`, `tmp\A04-before.json` и итоговое состояние шага 9, версии `rustc --version`, `cargo --version`.

## Откат / уборка

Обязателен, даже если шаги прошли.

```powershell
Remove-Item Env:LAVRAY_CI_REAL_WININET -ErrorAction SilentlyContinue
$conn = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings\Connections'
$fake = 'LAVRay CI fake RAS entry'
if ((Get-ItemProperty -Path $conn -ErrorAction SilentlyContinue).PSObject.Properties.Name -contains $fake) { Remove-ItemProperty -Path $conn -Name $fake }
(Get-ItemProperty -Path $conn -ErrorAction SilentlyContinue).PSObject.Properties.Name -contains $fake
```

Ожидается последняя строка `False`. Если шаг 9 показал расхождение общих значений прокси, верните раздел из снимка (`reg import C:\lavray-test\baseline\internet-settings.reg`) и повторите проверку из шага 9; повторное расхождение — `major`.

Затем удалите рабочую копию (каталог `target` большой, удаление может занять минуту):

```powershell
Set-Location C:\lavray-test
git -C $env:LAVRAY_SRC worktree remove --force (Join-Path $env:LAVRAY_TP_ROOT 'wt\A04')
git -C $env:LAVRAY_SRC worktree prune
Test-Path (Join-Path $env:LAVRAY_TP_ROOT 'wt\A04')
```

Ожидается `False`. Кэш `~\.cargo` оставьте.

## Отчёт

`results/A04.md` по `templates/REPORT.md`: статусы шагов 1–12, К1–К11, время сборки, сумма `passed`. Провал К3–К6 — `major`; К7 — `major` (проверка настоящего WinINET не выполнена); К8 — `critical`, если общие настройки прокси ПК изменились и не вернулись, иначе `major`.
