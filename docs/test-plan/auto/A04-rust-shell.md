# A04. Rust-оболочка: fmt, clippy, тесты, настоящий WinINET на выдуманной записи

| Поле | Значение |
|---|---|
| ID | A04 |
| Слой | авто |
| Время | 15–30 минут на свежем ПК (первая сборка дерева Tauri), 3–5 минут с тёплым кэшем |
| Зависимости | `01-ENVIRONMENT.md`, разделы 3–6 (страж, маркер `TESTPC_OK`). Выполняется последовательно с A10, A11 и M-файлами (см. `00-README.md`, группа S) |
| Опасность | реестр: один шаг (7–8) выполняет настоящие вызовы WinINET на **выдуманной** записи RAS и пишет значение в `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings\Connections`. Файл сам возвращает прежнее состояние и проверяет это. На теге v0.9.0 тест сам портит общий `ProxyServer` (известный дефект D-1), поэтому перед шагом 7 обязателен экспорт ключа `Internet Settings` (шаг 6), а возврат идёт из него |

## Цель

Выполнить задания `rust` и `rust-windows` CI на тестовом ПК: форматирование, clippy без предупреждений, все тесты оболочки, а на Windows ещё и тест `wininet_roundtrip_on_fake_ras_name` с настоящим WinINET (`LAVRAY_CI_REAL_WININET=1`). Покрывает эпик T-82 (остаток, Ф2): прокси LAN и записей RAS, снимок и откат, WPAD, автозапуск (на подставной ОС), горячая клавиша, уведомления, «Сохранить как» через диалог (путь выбирает только пользователь), поведение окна и трея (чистые решения), а также T-77 (захват экрана `capture`, на подставке). Что здесь **не** проверяется: поведение на живой системе (файл A11) и работа окна (файлы M).

## Предусловия

- **Тестовый ПК подтверждён**: `Test-TestPc` (из `env.ps1`) возвращает `True` — маркер `C:\lavray-test\TESTPC_OK` есть, создан на этом ПК и не старше 30 суток (раздел 3 файла `01-ENVIRONMENT.md`). Без маркера файл завершается итогом `BLOCKED`.
- Rust stable с `rustfmt` и `clippy`, Visual Studio Build Tools с рабочей нагрузкой C++, Node 24, Git (`01-ENVIRONMENT.md`, раздел 5).
- Сеть: `index.crates.io`, `static.crates.io`, `registry.npmjs.org`.
- 6–10 ГБ свободного места под `target\`.
- Нужен собранный интерфейс (`ui\dist`): `tauri::generate_context!` читает его на этапе компиляции. Шаг 2 строит его в рабочей копии.
- Новые крейты и обновление `Cargo.lock` запрещены: файл не запускает `cargo update` и проверяет, что `Cargo.lock` не изменился.

## Безопасность

Единственная запись в систему — шаги 7–8: тест `wininet_roundtrip_on_fake_ras_name` вызывает `InternetSetOptionW` с `INTERNET_OPTION_PER_CONNECTION_OPTION` для имени `LAVRay CI fake RAS entry` (имени нет в телефонной книге RAS, настоящие подключения не затрагиваются).

**Общий системный прокси LAN этот тест на `v0.9.0` не сохраняет.** Известный дефект D-1 («известно в 0.9.0, исправлено в 0.9.1»): на теге v0.9.0 настоящий вызов WinINET стирает `ProxyServer` в `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` и оставляет в подразделе `Connections` значение `LAVRay CI fake RAS entry`. Начиная с 0.9.1 тест сам снимает и возвращает четыре значения (`ProxyEnable`, `ProxyServer`, `ProxyOverride`, `AutoConfigURL`) и удаляет своё поддельное значение в `Connections`. На `v0.9.1` и позже шаги 7–9 обязаны пройти без расхождений: `Names одинаковы` и `ProxyServer то же` — `True` уже до уборки, а все остальные упоминания D-1 ниже относятся только к `v0.9.0`. Тест `lan_values_survive_a_real_ras_roundtrip` (с 0.9.1) на время теста записывает в `HKCU\...\Internet Settings` значения `ProxyEnable=0` и `ProxyServer=10.255.255.1:3128` и сам возвращает прежние. Поэтому порядок такой:

1. **До шага 7** оркестратор экспортирует ключ целиком (это делает шаг 6): `reg export "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" C:\lavray-test\tmp\A04-internet-settings-before.reg /y`. Общий снимок `baseline\internet-settings.reg` (`01-ENVIRONMENT.md`, раздел 8) остаётся запасным: его читают, не изменяют.
2. Шаг 9 сравнивает состояние после теста с состоянием шага 6 (`Names`, `DefaultConnectionSettings`, `ProxyEnable`, `ProxyServer`, `ProxyOverride`, `AutoConfigURL`) и удаляет поддельное значение из `Connections`.
3. Если `ProxyServer` изменён: на теге `v0.9.0` это известный дефект D-1, записывается как `FAIL` со ссылкой «известно в 0.9.0, исправлено в 0.9.1», на любом более позднем теге это регрессия (`FAIL`, новый дефект). В обоих случаях значение возвращается командой `reg import` из экспорта шага 6 (шаг 9 делает это сам).
4. Если расхождение дали `ProxyEnable`, `ProxyOverride`, `AutoConfigURL` или `DefaultConnectionSettings`, это не D-1: `FAIL`, `major`, откат из раздела «Откат».

Не запускайте шаги 7–8 на ПК, где работает чужой VPN: это правило CI («на ПК разработчика — никогда»). Страж из `01-ENVIRONMENT.md` это отсекает.

## Шаги

1. Страж и рабочая копия.

```powershell
. C:\lavray-test\env.ps1
if (-not (Test-TestPc)) { 'BLOCKED: нет маркера TESTPC_OK (или он создан на другом ПК, или старше 30 суток)'; return }
$wt = 'C:\lavray-test\wt\A04'
if (-not (Test-RepoLf)) { 'FAIL: в клоне src core.autocrlf не false (01-ENVIRONMENT.md, раздел 6); исправьте и повторите'; return }
git -C $env:LAVRAY_SRC worktree add --detach $wt $env:LAVRAY_REF
Set-Location $wt
"HEAD рабочей копии: " + (git rev-parse HEAD)
"коммит $($env:LAVRAY_REF):  " + (Get-RefCommit)
```

   Ожидается: маркер найден (`Test-TestPc` = `True`), `HEAD рабочей копии` равен `коммиту v0.9.1`.

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
# Полный экспорт ключа ДО настоящего теста: из него шаг 9 возвращает ProxyServer, если тест его испортил (дефект D-1 на v0.9.0).
reg export "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" C:\lavray-test\tmp\A04-internet-settings-before.reg /y
"reg export exit=$LASTEXITCODE"
```

   Ожидается: `reg export exit=0`, файл `tmp\A04-internet-settings-before.reg` непустой; печатается состояние; `Names` содержит как минимум `DefaultConnectionSettings` и `SavedLegacySettings` (на «чистой» Windows), значения `ProxyEnable` пусты или `0`. Если `ProxyEnable` равно `1`, страж не должен был пропустить машину: остановитесь с `BLOCKED`.

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
if ($env:LAVRAY_REF -ne 'v0.9.0') {   # тест D-1 добавлен в 0.9.1
  $env:LAVRAY_CI_REAL_WININET = '1'
  cargo test lan_values_survive_a_real_ras_roundtrip -- --nocapture 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A04-test-wininet-lan.txt | Select-String -Pattern '(пропущен|test result|lan_values)'
  Remove-Item Env:LAVRAY_CI_REAL_WININET
}
```

   Ожидается: строка `wininet_roundtrip_on_fake_ras_name ... ok`, строка `test result: ok. 1 passed`, и **нет** строки `пропущен: LAVRAY_CI_REAL_WININET не равна 1`. Наличие этой строки — `FAIL` шага (тест пропущен, переменная не дошла). Для `v0.9.1` и позже вторая команда блока даёт то же для `lan_values_survive_a_real_ras_roundtrip`: `test result: ok. 1 passed` и нет строки `пропущен`; на `v0.9.0` этого теста нет.

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
if ($before.ProxyServer -ne $after.ProxyServer) {
  if ($env:LAVRAY_REF -eq 'v0.9.0') { 'FAIL D-1 (известно в 0.9.0, исправлено в 0.9.1): тест изменил ProxyServer' }
  else { 'FAIL: регрессия D-1 (исправлено в 0.9.1): тест изменил ProxyServer' }
  reg import C:\lavray-test\tmp\A04-internet-settings-before.reg
  "reg import exit=$LASTEXITCODE"
}
$final = Get-ConnState
"Names после уборки = до: " + ($before.Names -eq $final.Names)
"ProxyServer после уборки = до: " + ($before.ProxyServer -eq $final.ProxyServer)
```

   Ожидается: все строки `True` после уборки. До уборки на теге `v0.9.0` ожидаемо `Names одинаковы: False` (лишнее значение `LAVRay CI fake RAS entry` оставляет тест, это часть D-1) и, при дефекте, `ProxyServer то же: False`: запишите оба факта в отчёт как `FAIL` К8 с отметкой «D-1, известно в 0.9.0, исправлено в 0.9.1»; после возврата все строки обязаны стать `True`. На более позднем теге лишнее значение в `Connections` и любое расхождение до уборки — регрессия. Расхождение `DefaultConnection`, `ProxyEnable`, `ProxyOverride` или `AutoConfigURL` — `FAIL` с серьёзностью `major` независимо от тега, и обязателен откат из раздела «Откат». Если после `reg import` `ProxyServer` всё ещё отличается (значения до теста не существовало, а `reg import` пустое значение не удаляет), приведите его к исходному вручную (`Remove-ItemProperty` для отсутствовавшего значения) и запишите в отчёт.

10. Права окна (capabilities) и проводка команд — отдельные тесты оболочки, запускаются явно, чтобы видеть их имена.

```powershell
cargo test --test capabilities --test main_wiring --test config_lint -- --list 2>&1 | Select-String -Pattern ': test$' | ForEach-Object { $_.Line.Trim() }
cargo test --test capabilities --test main_wiring --test config_lint 2>&1 | Select-String -Pattern '^test result'
```

    Ожидается: в списке есть `capabilities_contain_only_the_permissions_the_ui_uses`, `the_page_cannot_roll_the_system_proxy_back`, `opener_plugin_is_registered_and_limited_to_http_and_https`, `main_window_is_created_by_code_hidden_and_shown_unless_tray`, `nsis_uninstall_hook_removes_autostart_but_not_on_update` и, начиная с 0.9.1, `nsis_hooks_stop_the_core_and_forget_the_install_dir` (хуки останавливают ядро и забывают каталог установки, D-2); три строки `test result: ok.`. Содержимое `capabilities\default.json` не должно содержать `dialog:`, `fs:`, `notification:`:

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

    Ориентир: число `#[test]` в исходниках на `v0.9.0` было 457 (на `v0.9.1` больше: добавлены тесты WinINET, RAS и хуков NSIS). Часть тестов компилируется только под Windows или только под Unix, поэтому сумма `passed` обычно близка к числу `#[test]`, но точное эталонное число в плане не зафиксировано (при написании плана полный `cargo test` не запускался). Критерий: сумма `passed` от 90 до 115 % числа `#[test]`; точное значение запишите в отчёт.

## Критерии PASS/FAIL

| № | Критерий | Как проверить |
|---|---|---|
| К1 | Маркер `TESTPC_OK` есть и создан на этом ПК (`Test-TestPc`) | шаг 1 |
| К2 | UI собран (`ui\dist\index.html` существует) | шаг 2 |
| К3 | `cargo fmt --all -- --check` вернул 0 | `fmt exit=0` |
| К4 | `cargo clippy --all-targets -- -D warnings` вернул 0 | `clippy exit=0` |
| К5 | `cargo test` без разрешения вернул 0, у каждого `test result:` `0 failed` | шаг 5 |
| К6 | `cargo test` с `LAVRAY_CI_REAL_WININET=1` вернул 0 | шаг 7 |
| К7 | Настоящий тест не пропущен: `wininet_roundtrip_on_fake_ras_name ... ok`, строки `пропущен` нет | шаг 8 |
| К8 | После уборки состояние `Connections` и общие значения прокси равны исходным. На `v0.9.0` расхождение `ProxyServer` до возврата — известный дефект D-1: `FAIL` со ссылкой «известно в 0.9.0, исправлено в 0.9.1»; на более позднем теге такое расхождение недопустимо | шаг 9, после уборки все `True` |
| К9 | Пять защитных тестов оболочки (на `v0.9.1` и позже шесть) есть и проходят; в `capabilities` нет `dialog:`, `fs:`, `notification:` | шаг 10 |
| К10 | `Cargo.lock` и `Cargo.toml` не изменены, `cargo build` вернул 0 | шаг 11 |
| К11 | Сумма `passed` в пределах 90–115 % от числа `#[test]` | шаг 12 |

## Что собрать

В `results\A04\`: `A04-clippy.txt`, `A04-test-default.txt`, `A04-test-real-wininet.txt`, `A04-test-wininet-only.txt`, `tmp\A04-before.json`, `tmp\A04-internet-settings-before.reg` и итоговое состояние шага 9, версии `rustc --version`, `cargo --version`.

## Откат / уборка

Обязателен, даже если шаги прошли.

```powershell
Remove-Item Env:LAVRAY_CI_REAL_WININET -ErrorAction SilentlyContinue
$conn = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings\Connections'
$fake = 'LAVRay CI fake RAS entry'
if ((Get-ItemProperty -Path $conn -ErrorAction SilentlyContinue).PSObject.Properties.Name -contains $fake) { Remove-ItemProperty -Path $conn -Name $fake }
(Get-ItemProperty -Path $conn -ErrorAction SilentlyContinue).PSObject.Properties.Name -contains $fake
```

Ожидается последняя строка `False`. Если шаг 9 показал расхождение общих значений прокси, которое он сам не вернул, верните ключ из экспорта шага 6 (`reg import C:\lavray-test\tmp\A04-internet-settings-before.reg`; запасной вариант — общий снимок `reg import C:\lavray-test\baseline\internet-settings.reg`) и повторите проверку из шага 9; повторное расхождение — `major`.

Затем удалите рабочую копию (каталог `target` большой, удаление может занять минуту):

```powershell
Set-Location C:\lavray-test
git -C $env:LAVRAY_SRC worktree remove --force C:\lavray-test\wt\A04
git -C $env:LAVRAY_SRC worktree prune
Test-Path C:\lavray-test\wt\A04
```

Ожидается `False`. Кэш `~\.cargo` оставьте.

## Отчёт

`results/A04.md` по `templates/REPORT.md`: статусы шагов 1–12, К1–К11, время сборки, сумма `passed`. Провал К3–К6 — `major`; К7 — `major` (проверка настоящего WinINET не выполнена); К8 — `critical`, если общие настройки прокси ПК изменились и не вернулись, иначе `major`; на `v0.9.0` расхождение `ProxyServer` — известный дефект D-1 (`major`, «известно в 0.9.0, исправлено в 0.9.1»), новым дефектом его не заводят.
