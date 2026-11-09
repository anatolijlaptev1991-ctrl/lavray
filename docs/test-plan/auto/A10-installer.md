# A10. Установщик NSIS: тихая установка, обновление 0.3.0 → 0.9.3 поверх, миграция базы, удаление

| Поле | Значение |
|---|---|
| ID | A10 |
| Слой | авто |
| Время | 12–18 минут |
| Зависимости | A06 (ассеты скачаны и сверены: `assets\0.9.3` и `assets\0.3.0`), `01-ENVIRONMENT.md`, разделы 3–7; Python 3.12 (модуль `sqlite3`) для проверки базы данных. Выполняется **последовательно**, после A04 и A11 (группа S в `00-README.md`) |
| Опасность | **установка**: пишет в `C:\Program Files\LAVRay`, `HKLM\...\Uninstall`, меню «Пуск», общий рабочий стол (`C:\Users\Public\Desktop\LAVRay.lnk`), `HKCU\...\Run` (имитация автозапуска). Только тестовый ПК |

## Цель

Проверить жизненный цикл установленной версии без окна: тихая установка прежней версии 0.3.0, обновление поверх неё версией 0.9.3 с сохранением данных и автозапуска, удаление с проверкой «хвостов». Покрывает: «Установка поверх 0.3.0 сохраняет серверы, подписки, настройки и автозапуск» (заметки к выпуску 0.9.0), хук удаления `shell/windows/hooks.nsh` (автозапуск снимается при удалении, но не при обновлении), раздел «Установка» требований плана Ф3.0 (поведение `/S`, per-machine установка, установка более старой версии), бюджет размера установщика. **Миграция базы данных**: на данных, созданных настоящим ядром 0.3.0 (схема SQLite 4; у более ранних прежних версий 2 или 3), ядро 0.9.3 доводит схему до **6** (добавляются таблицы `web_users` и `import_map`; таблица `sessions` есть с схемы 4), не теряя серверов и настроек; повторный запуск ничего не меняет; ядро 0.3.0 на базе новой схемы отказывается стартовать (защита от «базы из будущего»). Версия схемы хранится в таблице `schema_version` (`SELECT MAX(version) FROM schema_version`), а не в `PRAGMA user_version`.

Внимание: поведение тихого NSIS-установщика Tauri при запущенном приложении и при понижении версии исследовано на одноразовом раннере (workflow `nsis-recon`, `docs/UPDATE-SYSTEM.md`, §12.7: Restart Manager завершает оболочку, понижение разрешено). На `v0.9.0` установщик останавливал только оболочку, ядро и каталог установки при удалении работающего приложения могли остаться, а ключ `HKLM\SOFTWARE\LAVRay` не забывался (дефект D-2, известно в 0.9.0, исправлено в 0.9.1). С `v0.9.1` установщик и удалитель останавливают оболочку и ждут выхода ядра: шаг 8 проверяется критерием К12, удаление работающего приложения (шаг 10) критерием К9. Шаг 9 (понижение) остаётся наблюдением и не влияет на итог файла.

## Предусловия

- **Тестовый ПК подтверждён**: `Test-TestPc` (из `env.ps1`) возвращает `True` — маркер `C:\lavray-test\TESTPC_OK` есть, создан на этом ПК и не старше 30 суток; иначе итог `BLOCKED`.
- PowerShell запущен **от имени администратора** (установщик на уровне компьютера). Проверка в шаге 1; без прав итог `BLOCKED` (тихая установка не может показать запрос UAC).
- Скачаны `assets\0.3.0` и `assets\0.9.3` с проверенными суммами (A06). Без релиза 0.9.3 — `BLOCKED`.
- LAVRay и `lavray-core` не запущены (страж из `01-ENVIRONMENT.md`).
- Программа не установлена до теста. Если установлена, итог `BLOCKED`: тест не должен затирать чужую установку.

## Безопасность

Меняется: каталог `C:\Program Files\LAVRay`, ветка `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall` (запись установщика), ярлык в меню «Пуск», ярлык `C:\Users\Public\Desktop\LAVRay.lnk` на общем рабочем столе (его создаёт установщик, убирает удалитель), значение `LAVRay` в `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (создаётся тестом, чтобы проверить сохранение автозапуска), файл `%APPDATA%\LAVRay\a10-marker.txt`. Системный прокси, TUN и порты не затрагиваются, приложение в основной части не запускается. Откат — шаг 10 и раздел «Откат»; в конце установленной программы быть не должно.

## Шаги

Имена файлов. Продукт называется LAVRay, но исполняемый файл оболочки в **установке** называется `lavray-shell.exe`; ядро лежит в `binaries\lavray-core.exe`. Имя `LAVRay.exe` носит только оболочка внутри **portable ZIP** (её переименовывает release-workflow). Ярлыки называются `LAVRay.lnk`. Процесс установленной оболочки — `lavray-shell`, оболочки из portable ZIP — `LAVRay`; везде ниже, где нужно убедиться, что программа не запущена, перечислены оба имени.

1. Права, маркер, исходное состояние.

```powershell
. C:\lavray-test\env.ps1
if (-not (Test-TestPc)) { 'BLOCKED: нет маркера TESTPC_OK (или он создан на другом ПК, или старше 30 суток)'; return }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
"администратор: $isAdmin"
$pf = Join-Path $env:ProgramFiles 'LAVRay'      # только каталог LAVRay, не весь Program Files
$desk = 'C:\Users\Public\Desktop\LAVRay.lnk'     # ярлык на общем рабочем столе: создаёт установщик, убирает удалитель
$setupNew = Join-Path $env:LAVRAY_ASSETS    ('LAVRay-' + $env:LAVRAY_VERSION      + '-x64-setup.exe')
$setupOld = Join-Path $env:LAVRAY_ASSETS_OLD ('LAVRay-' + $env:LAVRAY_FROM_VERSION + '-x64-setup.exe')
"новый установщик есть: " + (Test-Path $setupNew)
"прежний установщик есть: " + (Test-Path $setupOld)
function Get-LavrayUninstall {
  $roots = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
  foreach ($r in $roots) {
    if (Test-Path $r) {
      Get-ChildItem $r | ForEach-Object {
        $p = Get-ItemProperty $_.PSPath
        if ($p.DisplayName -eq 'LAVRay') {
          [pscustomobject]@{ Key = $_.PSPath; Version = $p.DisplayVersion; Publisher = $p.Publisher; Uninstall = $p.UninstallString; Location = $p.InstallLocation }
        }
      }
    }
  }
}
"запись об установке до теста: " + [bool](Get-LavrayUninstall)
"каталог программы до теста:   " + (Test-Path $pf)
"ярлык на рабочем столе до теста: " + (Test-Path $desk)
"процессы LAVRay:              " + [bool](Get-Process LAVRay, lavray-shell, lavray-core -ErrorAction SilentlyContinue)
$dataDir = Join-Path $env:APPDATA 'LAVRay'
$dataExisted = Test-Path $dataDir
$webv = @((Join-Path $env:APPDATA 'io.github.anatolijlaptev1991-ctrl.lavray'), (Join-Path $env:LOCALAPPDATA 'io.github.anatolijlaptev1991-ctrl.lavray'))
$webvBefore = @{}
foreach ($d in $webv) { $webvBefore[$d] = Test-Path $d }
"каталог данных до теста: $dataExisted"
"каталоги WebView2 до теста: " + (($webv | ForEach-Object { $webvBefore[$_] }) -join ', ')
$runBefore = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).LAVRay
"значение автозапуска до теста: " + $(if ($runBefore) { $runBefore } else { '(нет)' })
```

   Ожидается: `администратор: True`, оба установщика есть, «запись об установке до теста: False», «каталог программы до теста: False», «ярлык на рабочем столе до теста: False», «процессы LAVRay: False», автозапуск `(нет)`. Иначе итог `BLOCKED` с названием причины.

2. Тихая установка прежней версии 0.3.0 (в этом файле `-Wait` ждёт завершения; сам NSIS при `/S` не показывает окон).

```powershell
$p = Start-Process -FilePath $setupOld -ArgumentList '/S' -Wait -PassThru
"установка 0.3.0: код $($p.ExitCode)"
Get-LavrayUninstall | Format-List
# Только каталог LAVRay; -ErrorAction SilentlyContinue обязателен, иначе обход вширь упирается в защищённые каталоги (например, Windows Defender).
Get-ChildItem -LiteralPath $pf -Recurse -ErrorAction SilentlyContinue | Select-Object FullName, Length | Format-Table -AutoSize | Out-String -Width 200
```

   Ожидается: код `0`; запись об установке с `Version = 0.3.0`; файлы `lavray-shell.exe`, `binaries\lavray-core.exe`, `uninstall.exe` в `C:\Program Files\LAVRay`. Запомните точное имя ключа реестра и значение `Uninstall` (путь к удалителю): они нужны для шага 9.

3. Состав установки: файлы, ярлык в меню «Пуск», ярлык на общем рабочем столе.

```powershell
foreach ($f in 'lavray-shell.exe', 'binaries\lavray-core.exe', 'uninstall.exe') {
  $path = Join-Path $pf $f
  '{0,-28} {1,10} байт  {2}' -f $f, $(if (Test-Path $path) { (Get-Item $path).Length } else { -1 }), $(if (Test-Path $path) { (Get-FileHash $path -Algorithm SHA256).Hash.Substring(0, 16) } else { '' })
}
$lnk = Get-ChildItem "$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter 'LAVRay*.lnk' -ErrorAction SilentlyContinue
$lnk | Select-Object FullName
$sh = New-Object -ComObject WScript.Shell
if ($lnk) { "цель ярлыка меню «Пуск»: " + $sh.CreateShortcut($lnk[0].FullName).TargetPath }
"ярлык на общем рабочем столе ($desk): " + (Test-Path $desk)
if (Test-Path $desk) { "цель ярлыка рабочего стола: " + $sh.CreateShortcut($desk).TargetPath }
```

   Ожидается: три файла размером больше нуля (отрицательный размер — файла нет); найден хотя бы один ярлык `LAVRay*.lnk`, цель — `C:\Program Files\LAVRay\lavray-shell.exe`; ярлык рабочего стола `C:\Users\Public\Desktop\LAVRay.lnk` существует (`True`) и ведёт на тот же файл. Точный путь ярлыка (общее меню «Пуск» или меню пользователя) запишите в отчёт: он зависит от настроек сборки установщика и в коде репозитория не зафиксирован.

4. Подготовка данных и автозапуска (имитация пользователя 0.3.0).

```powershell
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$marker = Join-Path $dataDir 'a10-marker.txt'
Set-Content -LiteralPath $marker -Value ('a10-' + [guid]::NewGuid().ToString()) -Encoding utf8
$markerHash = (Get-FileHash $marker -Algorithm SHA256).Hash
$runValue = '"' + (Join-Path $pf 'lavray-shell.exe') + '" --tray'
Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'LAVRay' -Value $runValue
(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run').LAVRay
```

   Ожидается: значение автозапуска вида `"C:\Program Files\LAVRay\lavray-shell.exe" --tray` (так же его пишет сама программа, см. `shell/src/autostart.rs`).

   Настоящая база прежней версии. Установленное ядро 0.3.0 само создаёт каталог данных (отдельный, не `%APPDATA%\LAVRay`, чтобы не трогать данные пользователя): профили `a10-keep-1` и `a10-keep-2` (у второго задан `customOutboundJson`), настройка `inbound.port = 2091`. Сохраните скрипт из раздела «Скрипт `a10_data.py`» как `C:\lavray-test\tmp\A10\a10_data.py`.

```powershell
$t = 'C:\lavray-test\tmp\A10'
New-Item -ItemType Directory -Force -Path $t, C:\lavray-test\results\A10 | Out-Null
$dbData = Join-Path $t 'data'
$coreOld = Join-Path $pf 'binaries\lavray-core.exe'    # ядро 0.3.0 из установки
python -I "$t\a10_data.py" seed $coreOld $dbData 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A10\seed.txt
"seed exit=$LASTEXITCODE"
```

   Ожидается: четыре строки `PASS` (`seed.profiles_created`, `seed.old_schema_is_2_3_or_4`, `seed.new_tables_absent`, `seed.port_saved`), `схема прежней версии: 4 (0.3.0: 4)`, `seed exit=0`.

5. Обновление: установка 0.9.3 поверх 0.3.0.

```powershell
$p = Start-Process -FilePath $setupNew -ArgumentList '/S' -Wait -PassThru
"обновление до 0.9.3: код $($p.ExitCode)"
$u = @(Get-LavrayUninstall)
"записей об установке: $($u.Count)"
$u | Format-List
```

   Ожидается: код `0`; ровно **одна** запись об установке, `Version = 0.9.3` (две записи — прежняя не заменена, `FAIL`).

6. После обновления: файлы той же версии, что в portable; данные и автозапуск сохранены.

```powershell
$portable = $env:LAVRAY_PORTABLE
# установленная оболочка lavray-shell.exe = LAVRay.exe из portable ZIP (release-workflow лишь переименовывает файл)
foreach ($pair in @(@('lavray-shell.exe', 'LAVRay.exe'), @('binaries\lavray-core.exe', 'binaries\lavray-core.exe'))) {
  $a = (Get-FileHash (Join-Path $pf $pair[0]) -Algorithm SHA256).Hash
  $b = (Get-FileHash (Join-Path $portable $pair[1]) -Algorithm SHA256).Hash
  '{0,-26} совпадает с portable: {1}' -f $pair[0], ($a -eq $b)
}
"маркер данных на месте и не изменён: " + ((Test-Path $marker) -and ((Get-FileHash $marker -Algorithm SHA256).Hash -eq $markerHash))
$runAfter = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).LAVRay
"автозапуск сохранён: " + ($runAfter -eq $runValue)
"ярлык на месте: " + [bool](Get-ChildItem "$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter 'LAVRay*.lnk' -ErrorAction SilentlyContinue)
"ярлык на рабочем столе на месте: " + (Test-Path $desk)
"установщик NSIS не оставил задач планировщика: " + (-not [bool](Get-ScheduledTask -TaskName 'LAVRay*' -ErrorAction SilentlyContinue))
```

   Ожидается: обе строки «совпадает с portable: True» (установщик и ZIP собираются из одних и тех же файлов; расхождение хэшей — `WARN`, запишите оба хэша), маркер на месте и не изменён, автозапуск сохранён (заметки 0.9.0: «Установка поверх 0.3.0 сохраняет серверы, подписки, настройки и автозапуск»; хук удаления не должен срабатывать при обновлении), ярлык в меню «Пуск» и ярлык рабочего стола `C:\Users\Public\Desktop\LAVRay.lnk` на месте, задач планировщика нет (мы их не создавали).

   База данных после обновления. Ядро 0.9.3 из установки открывает **ту же** базу, проверяются версия схемы, таблицы, данные и экспорт копии `.lavbk`:

```powershell
$coreNew = Join-Path $pf 'binaries\lavray-core.exe'    # ядро 0.9.3 после обновления поверх
python -I "$t\a10_data.py" verify $coreNew $dbData $env:LAVRAY_VERSION 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A10\verify.txt
"verify exit=$LASTEXITCODE"
python -I "$t\a10_data.py" state $dbData
```

   Ожидается: двенадцать строк `PASS` (`verify.core_version`, `verify.profiles_kept`, `verify.fields_kept`, `verify.custom_fields_stay_unconfirmed`, `verify.setting_kept`, `verify.backup_export_works`, `verify.schema_is_6`, `verify.new_tables_created`, `verify.old_tables_kept`, `verify.rows_kept`, `verify.integrity_ok`, `verify.second_start_idempotent`) и `verify exit=0`; `state` печатает `"schema": 6`, `"versions": [1, 2, 3, 4, 5, 6]`, таблицы `web_users` и `import_map` и `"integrity": "ok"`. Таблица `schema_version` сохраняет строки прежних миграций (миграции только добавляются). Экспорт зашифрованной копии (`BackupService`) работает на мигрированной базе; старого открытого экспорта настроек в JSON в 0.9.3 нет (это интерфейс, M01 и M11)

7. Размер установщика и подпись (справочно, повторяет A06).

```powershell
'{0:N1} МБ' -f ((Get-Item $setupNew).Length / 1MB)
(Get-AuthenticodeSignature $setupNew).Status
```

   Ожидается: не больше 25 МБ; статус `NotSigned` (см. A06, шаг 10).

8. Наблюдение: повторный запуск `/S` при **запущенном** приложении (план Ф3.0). Запись результата, не критерий.

```powershell
$app = Start-Process -FilePath (Join-Path $pf 'lavray-shell.exe') -ArgumentList '--tray' -PassThru
Start-Sleep -Seconds 15
"приложение работает до установки: " + [bool](Get-Process -Id $app.Id -ErrorAction SilentlyContinue)
$p = Start-Process -FilePath $setupNew -ArgumentList '/S' -Wait -PassThru
"повторная установка при запущенном приложении: код $($p.ExitCode)"
Start-Sleep -Seconds 10
"процесс lavray-shell жив после установки: " + [bool](Get-Process lavray-shell -ErrorAction SilentlyContinue)
"процессов lavray-core: " + @(Get-Process lavray-core -ErrorAction SilentlyContinue).Count
Get-Process LAVRay, lavray-shell, lavray-core -ErrorAction SilentlyContinue | Stop-Process -Force
```

   Запишите все четыре значения в таблицу «Наблюдения» отчёта (установщик остановил приложение, оставил его, завершился с ошибкой, перезапустил его). На `v0.9.0` любой исход допустим (ядро могло остаться). На `v0.9.1` и позже (D-2) исход определён (К12): код `0`, «процесс lavray-shell жив после установки: False», «процессов lavray-core: 0» (установщик остановил оболочку и дождался выхода ядра; само приложение он не перезапускает). Если приложение в `--tray` не стартовало (процесса нет уже до установки), запишите это отдельным наблюдением: нужна диагностика запуска.

9. Наблюдение: установка прежней версии поверх новой (понижение, нужно для отката в плане Ф3.0), затем возврат к 0.9.3 для чистого удаления.

```powershell
$p = Start-Process -FilePath $setupOld -ArgumentList '/S' -Wait -PassThru
$v = (@(Get-LavrayUninstall) | ForEach-Object Version) -join ','
"понижение до 0.3.0: код $($p.ExitCode); версия в реестре: $v"
```

   База при понижении (на **копии** базы схемы 6; боевой каталог не трогается). Пока установлено ядро 0.3.0, до возврата к 0.9.3:

```powershell
python -I "$t\a10_data.py" probe (Join-Path $pf 'binaries\lavray-core.exe') $dbData 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A10\probe.txt
"probe exit=$LASTEXITCODE"
```

   Ожидается: строка `OBSERVATION старое ядро на базе схемы 6 не стартовало: …`, `PASS probe.old_core_refuses_newer_schema` и `probe exit=0` (ядро 0.3.0 не принимает базу «из будущего» и не портит её). Если старое ядро стартовало, скрипт печатает `OBSERVATION … стартовало` и проверяет `probe.old_core_did_not_downgrade_schema` (схема не должна измениться); запишите это; потеря данных при понижении — `major`.

```powershell
$p = Start-Process -FilePath $setupNew -ArgumentList '/S' -Wait -PassThru
$v = (@(Get-LavrayUninstall) | ForEach-Object Version) -join ','
"возврат к 0.9.3: код $($p.ExitCode); версия в реестре: $v"
```

   Запишите коды и версии в «Наблюдения». Критерии: после возврата ровно одна запись об установке и `Version = 0.9.3` (К8); проверка базы выше (К11).

10. Удаление и «хвосты».

```powershell
$u = @(Get-LavrayUninstall)[0]
$u.Uninstall
$un = Join-Path $pf 'uninstall.exe'
if ($env:LAVRAY_REF -ne 'v0.9.0') {
  # С 0.9.1 (D-2) удаляем при ЗАПУЩЕННОМ приложении: удалитель обязан остановить оболочку и ядро и ничего не оставить.
  $app = Start-Process -FilePath (Join-Path $pf 'lavray-shell.exe') -ArgumentList '--tray' -PassThru
  Start-Sleep -Seconds 15
  "оболочка работает перед удалением: " + [bool](Get-Process lavray-shell -ErrorAction SilentlyContinue)
  "ядро работает перед удалением:     " + [bool](Get-Process lavray-core -ErrorAction SilentlyContinue)
}
$p = Start-Process -FilePath $un -ArgumentList '/S' -PassThru
# удалитель NSIS может перезапустить себя из временного каталога и вернуть управление сразу: ждём результат опросом
$sw = [Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt 90 -and ((Test-Path (Join-Path $pf 'lavray-shell.exe')) -or @(Get-LavrayUninstall).Count -gt 0)) { Start-Sleep -Seconds 2 }
"удаление завершено за: $([int]$sw.Elapsed.TotalSeconds) с"
"lavray-shell.exe удалён:      " + (-not (Test-Path (Join-Path $pf 'lavray-shell.exe')))
"binaries\lavray-core.exe удалён: " + (-not (Test-Path (Join-Path $pf 'binaries\lavray-core.exe')))
"каталог программы удалён:     " + (-not (Test-Path $pf))
"запись об установке удалена:  " + (-not [bool](Get-LavrayUninstall))
"ключ HKLM\SOFTWARE\LAVRay удалён: " + (-not (Test-Path 'HKLM:\SOFTWARE\LAVRay'))
"ярлыков нет:                  " + (-not [bool](Get-ChildItem "$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter 'LAVRay*.lnk' -ErrorAction SilentlyContinue))
"ярлык рабочего стола удалён:  " + (-not (Test-Path $desk))
"автозапуск Run снят:          " + (-not [bool]((Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).LAVRay))
"задач планировщика нет:       " + (-not [bool](Get-ScheduledTask -TaskName 'LAVRay', 'LAVRay-*' -ErrorAction SilentlyContinue))
"процессов нет:                " + (-not [bool](Get-Process LAVRay, lavray-shell, lavray-core -ErrorAction SilentlyContinue))
"данные пользователя сохранены (политика): " + ((Test-Path $marker) -and ((Get-FileHash $marker -Algorithm SHA256).Hash -eq $markerHash))
```

    Политика «хвостов» (источник: `shell/windows/hooks.nsh` и каталог данных `%APPDATA%\LAVRay`, который создаёт сама программа вне установщика):

    | Что | После удаления |
    |---|---|
    | Файлы в `C:\Program Files\LAVRay`, сам каталог | удалены |
    | Запись в `Uninstall`, ярлык «Пуск», ярлык `C:\Users\Public\Desktop\LAVRay.lnk` на общем рабочем столе | удалены |
    | Ключ производителя `HKLM\SOFTWARE\LAVRay` (в нём запоминался каталог установки) | удалён (хук `NSIS_HOOK_POSTUNINSTALL`, D-2; на v0.9.0 оставался и отправлял следующую тихую установку не в `Program Files`) |
    | Значение `HKCU\...\Run\LAVRay`, задачи планировщика `LAVRay`, `LAVRay-<SID>` | удалены (хук `NSIS_HOOK_POSTUNINSTALL`, не при обновлении) |
    | `%APPDATA%\LAVRay` (серверы, подписки, настройки, `ui-state.json`) | **сохраняются**: удалитель их не знает и пользователь не должен терять данные |
    | `%APPDATA%\io.github.anatolijlaptev1991-ctrl.lavray`, `%LOCALAPPDATA%\io.github.anatolijlaptev1991-ctrl.lavray` (профиль WebView2) | допустимы; удалитель Tauri стирает их только по явной галочке «Удалить данные приложения»; поведение `/S` для этой галочки запишите в «Наблюдения» |

    Ожидается: все строки `True`. Каждая `False` строка про файлы, запись, ключ `HKLM\SOFTWARE\LAVRay`, ярлык, автозапуск, задачи или процессы — `FAIL`. На `v0.9.1` и позже удаление идёт при запущенном приложении (блок выше запускает его), и `Program Files\LAVRay` с `HKLM\SOFTWARE\LAVRay` обязаны исчезнуть. На `v0.9.0` блок запуска пропускается; строка про ключ `HKLM\SOFTWARE\LAVRay` там даёт `False` (известный D-2).

11. Что осталось после удаления, для отчёта.

```powershell
Get-ChildItem $env:ProgramFiles -Filter 'LAVRay*' -ErrorAction SilentlyContinue
Get-ChildItem 'C:\Users\Public\Desktop' -Filter 'LAVRay*.lnk' -ErrorAction SilentlyContinue
"HKLM\SOFTWARE\LAVRay: " + (Test-Path 'HKLM:\SOFTWARE\LAVRay')
Get-ChildItem $dataDir, $webv[0], $webv[1] -ErrorAction SilentlyContinue | Select-Object FullName, Length -First 20
```

    Ожидается: в `Program Files` и на общем рабочем столе (`C:\Users\Public\Desktop`) ничего, `HKLM\SOFTWARE\LAVRay: False`; из пользовательских данных — только каталоги из таблицы политики.

## Критерии PASS/FAIL

| № | Критерий | Как проверить |
|---|---|---|
| К1 | Шаг 1: права администратора, маркер, чистое исходное состояние | значения |
| К2 | Шаг 2: тихая установка 0.3.0, код 0, запись `Version = 0.3.0`, три файла | вывод |
| К3 | Шаг 3: найден ярлык «Пуск» с целью `lavray-shell.exe` и ярлык рабочего стола `C:\Users\Public\Desktop\LAVRay.lnk` | вывод |
| К4 | Шаг 5: обновление, код 0, **одна** запись, `Version = 0.9.3` | вывод |
| К5 | Шаг 6: установленные `lavray-shell.exe` и `lavray-core.exe` совпадают с `LAVRay.exe` и `binaries\lavray-core.exe` из portable (при расхождении `WARN`) | `True` |
| К6 | Шаг 6: данные (маркер) и автозапуск сохранены, ярлыки («Пуск» и рабочий стол) на месте | `True` |
| К7 | Шаг 7: установщик не больше 25 МБ | значение |
| К8 | Шаг 9: после возврата одна запись и `Version = 0.9.3` | вывод |
| К9 | Шаг 10: все строки удаления `True`, включая сохранение данных пользователя; с 0.9.1 удаление идёт при запущенном приложении и не оставляет `Program Files\LAVRay` и `HKLM\SOFTWARE\LAVRay` | вывод |
| К10 | Шаги 4 и 6: база прежней версии (схема 4) после обновления имеет схему **6**, данные и настройки целы, второй запуск ничего не меняет, экспорт `.lavbk` работает | `seed exit=0`, `verify exit=0`, 12 строк `PASS` |
| К11 | Шаг 9 (наблюдение с проверкой): ядро 0.3.0 не принимает базу схемы 6 или, приняв, не меняет её | `probe exit=0` |
| К12 | Шаг 8 (с 0.9.1, D-2): тихая установка поверх работающего приложения завершается кодом `0` и останавливает оболочку и ядро (`lavray-shell` и `lavray-core` не живы после установки) | вывод |

Шаг 9 (кроме К8 и К11) — наблюдение, его исход не меняет итог. Шаг 8 на `v0.9.0` — наблюдение, на `v0.9.1` и позже — К12.

## Что собрать

`results\A10\`: вывод шагов 2, 3, 5, 6, 10 целиком; `seed.txt`, `verify.txt`, `probe.txt` и вывод `state`; таблица «Наблюдения» (шаги 8–9: коды установщика, был ли убит процесс, версия после понижения, судьба каталогов WebView2); путь ярлыка; имя ключа `Uninstall`.

## Откат / уборка

Обязателен. Выполняется всегда, даже если шаги прошли или тест остановлен на середине.

```powershell
Get-Process LAVRay, lavray-shell, lavray-core -ErrorAction SilentlyContinue | Stop-Process -Force
$u = @(Get-LavrayUninstall)
if ($u.Count -gt 0) {
  $un = Join-Path $pf 'uninstall.exe'
  if (Test-Path $un) {
    Start-Process -FilePath $un -ArgumentList '/S' -PassThru | Out-Null
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline -and @(Get-LavrayUninstall).Count -gt 0) { Start-Sleep -Seconds 2 }
  }
}
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'LAVRay' -ErrorAction SilentlyContinue
Get-ScheduledTask -TaskName 'LAVRay', 'LAVRay-*' -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
Remove-Item -LiteralPath 'C:\Users\Public\Desktop\LAVRay.lnk' -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'HKLM:\SOFTWARE\LAVRay' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force 'C:\lavray-test\tmp\A10' -ErrorAction SilentlyContinue
if (-not $dataExisted -and (Test-Path $dataDir)) { Remove-Item -Recurse -Force $dataDir }
else { Remove-Item -LiteralPath (Join-Path $dataDir 'a10-marker.txt') -Force -ErrorAction SilentlyContinue }
foreach ($d in $webv) { if (-not $webvBefore[$d] -and (Test-Path $d)) { Remove-Item -Recurse -Force $d } }
"запись об установке: " + [bool](Get-LavrayUninstall)
"каталог программы:   " + (Test-Path $pf)
"автозапуск Run:      " + [bool]((Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).LAVRay)
"ярлык рабочего стола: " + (Test-Path 'C:\Users\Public\Desktop\LAVRay.lnk')
"ключ HKLM\SOFTWARE\LAVRay: " + (Test-Path 'HKLM:\SOFTWARE\LAVRay')
```

Ожидается: пять строк `False`. Если запись или каталог остались, а удалитель не отработал, удалите вручную `C:\Program Files\LAVRay` и ключ `Uninstall`, найденный `Get-LavrayUninstall` (`Remove-Item -Recurse -Force <Key>`), и запишите это как дефект `major` (удалитель не убрал установку). Если машина виртуальная, откат снимка надёжнее.

Каталоги данных и профиля WebView2 удаляются только если их не было до теста (значения сохранены в шаге 1).

## Отчёт

`results/A10.md` по `templates/REPORT.md`: статусы 11 шагов, К1–К12, таблица «Наблюдения». Провал К4 (две записи), К6 (потеря данных или автозапуска при обновлении) и К10 (потеря серверов или настроек, схема не дошла до 6, повреждение базы) — `critical`; К9 (оставленные файлы, запись, ключ `HKLM\SOFTWARE\LAVRay`, автозапуск, задачи) и К12 (установщик не остановил ядро) — `major`; остальные — `major`/`minor` по вашей оценке.

## Скрипт `a10_data.py`

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A10 (часть «данные при обновлении»): настоящая база SQLite прежней версии 0.3.0 переживает обновление до 0.9.3.

  python -I a10_data.py seed    <core 0.3.0> <каталог данных>             создать данные прежней версии (схема 2-4; у 0.3.0 - 4)
  python -I a10_data.py state   <каталог данных>                          схема, таблицы, число записей (только чтение)
  python -I a10_data.py verify  <core 0.9.3> <каталог данных> <версия>    проверки после обновления (схема 6, данные целы)
  python -I a10_data.py probe   <core 0.3.0> <каталог данных>             наблюдение: старое ядро на копии базы новой схемы

Код выхода 0 - все проверки PASS. Секреты не используются: пароль копии тестовый, копия в памяти и на диск не пишется.
"""
import json
import os
import pathlib
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
FAILED = []
NL = chr(10)
WANT_TABLES = {"web_users", "import_map"}  # появились после 0.3.0 (схемы 5 и 6); таблица sessions (схема 4) есть уже в 0.3.0


def check(cid, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + cid + ("" if ok else " :: " + str(detail)[:200]), flush=True)
    if not ok:
        FAILED.append(cid)


class Core:
    def __init__(self, exe, data):
        self.tok = secrets.token_urlsafe(32)
        self.p = subprocess.Popen([exe, "serve", "--listen-socket", "127.0.0.1:0", "--data", data], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.p.stdin.write((self.tok + NL).encode())
        self.p.stdin.flush()
        line = self.p.stdout.readline().decode().strip()
        if "LAVRAY_CORE_READY" not in line:
            self.p.kill()
            raise RuntimeError("ядро не стартовало: " + (self.p.stderr.read().decode("utf-8", "replace")[:300] or line))
        self.base = "http://" + line.split()[1].replace("tcp://", "")

    def rpc(self, svc, method, body=None):
        req = urllib.request.Request(f"{self.base}/lavray.v1.{svc}/{method}", data=json.dumps(body or {}).encode(),
                                     headers={"Authorization": "Bearer " + self.tok, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace")
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, raw

    def stop(self):
        try:
            self.p.stdin.close()
            self.p.wait(timeout=30)
        except Exception:  # noqa: BLE001
            self.p.kill()
            self.p.wait()


def db(data):
    p = os.path.join(data, "lavray.db")
    return sqlite3.connect(pathlib.Path(p).resolve().as_uri() + "?mode=ro", uri=True)


def state(data):
    con = db(data)
    try:
        out = {"schema": con.execute("SELECT MAX(version) FROM schema_version").fetchone()[0],
               "versions": [r[0] for r in con.execute("SELECT version FROM schema_version ORDER BY version")],
               "tables": sorted(r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")),
               "profiles": con.execute("SELECT COUNT(*) FROM profiles").fetchone()[0],
               "groups": con.execute("SELECT COUNT(*) FROM groups").fetchone()[0],
               "port": (con.execute("SELECT value FROM settings WHERE key='inbound.port'").fetchone() or [None])[0],
               "integrity": con.execute("PRAGMA integrity_check").fetchone()[0]}
    finally:
        con.close()
    return out


def seed(exe, data):
    os.makedirs(data, exist_ok=True)
    c = Core(exe, data)
    try:
        gid = c.rpc("ProfileService", "ListGroups", {})[1]["groups"][0]["id"]
        c.rpc("ProfileService", "CreateProfile", {"profile": {"groupId": gid, "type": "PROFILE_TYPE_SOCKS", "name": "a10-keep-1", "address": "127.0.0.1", "port": 1081,
                                                              "socksHttp": {"proto": "PROTO_SOCKS5"}}})
        c.rpc("ProfileService", "CreateProfile", {"profile": {"groupId": gid, "type": "PROFILE_TYPE_SOCKS", "name": "a10-keep-2", "address": "127.0.0.1", "port": 1082,
                                                              "socksHttp": {"proto": "PROTO_SOCKS5"}, "customOutboundJson": '{"connect_timeout": "7s"}'}})
        c.rpc("SettingsService", "SetSettings", {"values": {"inbound.port": {"intValue": "2091"}}})
        names = sorted(p["name"] for p in c.rpc("ProfileService", "ListProfiles", {})[1].get("profiles", []))
    finally:
        c.stop()
    st = state(data)
    check("seed.profiles_created", names == ["a10-keep-1", "a10-keep-2"], names)
    check("seed.old_schema_is_2_3_or_4", st["schema"] in (2, 3, 4) and st["versions"] == list(range(1, st["schema"] + 1)), st)
    print("схема прежней версии:", st["schema"], "(0.3.0: 4)")
    check("seed.new_tables_absent", not (WANT_TABLES & set(st["tables"])), st["tables"])
    check("seed.port_saved", st["port"] == "2091", st["port"])
    print("состояние прежней версии:", json.dumps(st, ensure_ascii=False))


def verify(exe, data, version):
    before = state(data)
    c = Core(exe, data)
    try:
        st, status = c.rpc("CoreService", "GetStatus", {})
        check("verify.core_version", st == 200 and status.get("coreVersion") == version, status.get("coreVersion") if isinstance(status, dict) else status)
        profs = {p["name"]: p for p in c.rpc("ProfileService", "ListProfiles", {})[1].get("profiles", [])}
        check("verify.profiles_kept", set(profs) == {"a10-keep-1", "a10-keep-2"}, sorted(profs))
        p2 = profs.get("a10-keep-2", {})
        check("verify.fields_kept", profs.get("a10-keep-1", {}).get("port") == 1081 and p2.get("port") == 1082 and p2.get("customOutboundJson") == '{"connect_timeout": "7s"}', p2)
        check("verify.custom_fields_stay_unconfirmed", not p2.get("customFieldsConfirmed"), p2.get("customFieldsConfirmed"))
        st, sv = c.rpc("SettingsService", "GetSettings", {"keys": ["inbound.port"]})
        check("verify.setting_kept", st == 200 and sv.get("values", {}).get("inbound.port", {}).get("intValue") == "2091", sv)
        st, bk = c.rpc("BackupService", "ExportBackup", {"password": "a10-test-password-1"})
        summ = bk.get("summary", {}) if st == 200 else {}
        check("verify.backup_export_works", st == 200 and bk.get("suggestedName", "").endswith(".lavbk") and summ.get("profiles") == 2 and str(summ.get("schemaVersion")) == "6", (st, summ))
    finally:
        c.stop()
    after = state(data)
    check("verify.schema_is_6", after["schema"] == 6 and after["versions"] == [1, 2, 3, 4, 5, 6], after)
    check("verify.new_tables_created", WANT_TABLES <= set(after["tables"]), after["tables"])
    check("verify.old_tables_kept", set(before["tables"]) <= set(after["tables"]), sorted(set(before["tables"]) - set(after["tables"])))
    check("verify.rows_kept", after["profiles"] == before["profiles"] and after["groups"] == before["groups"] and after["port"] == before["port"], (before, after))
    check("verify.integrity_ok", after["integrity"] == "ok", after["integrity"])
    # второй запуск не меняет схему и не плодит записи
    c = Core(exe, data)
    c.stop()
    again = state(data)
    check("verify.second_start_idempotent", again["schema"] == 6 and again["profiles"] == after["profiles"] and again["versions"] == after["versions"], again)
    print("состояние после обновления:", json.dumps(after, ensure_ascii=False))


def probe(exe, data):
    tmp = tempfile.mkdtemp(prefix="a10-probe-")
    dst = os.path.join(tmp, "data")
    shutil.copytree(data, dst, ignore=shutil.ignore_patterns("geo"))
    before = state(dst)
    try:
        c = Core(exe, dst)
    except RuntimeError as e:
        print("OBSERVATION старое ядро на базе схемы", before["schema"], "не стартовало:", str(e)[:200])
        check("probe.old_core_refuses_newer_schema", True)
        shutil.rmtree(tmp, ignore_errors=True)
        return
    try:
        st, sv = c.rpc("SettingsService", "GetSettings", {"keys": ["inbound.port"]})
    finally:
        c.stop()
    after = state(dst)
    print("OBSERVATION старое ядро стартовало на базе схемы", before["schema"], "; после: ", json.dumps(after, ensure_ascii=False))
    check("probe.old_core_did_not_downgrade_schema", after["schema"] == before["schema"], after)
    shutil.rmtree(tmp, ignore_errors=True)


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "seed" and len(sys.argv) == 4:
        seed(os.path.abspath(sys.argv[2]), os.path.abspath(sys.argv[3]))
    elif cmd == "state" and len(sys.argv) == 3:
        print(json.dumps(state(os.path.abspath(sys.argv[2])), ensure_ascii=False))
    elif cmd == "verify" and len(sys.argv) == 5:
        verify(os.path.abspath(sys.argv[2]), os.path.abspath(sys.argv[3]), sys.argv[4])
    elif cmd == "probe" and len(sys.argv) == 4:
        probe(os.path.abspath(sys.argv[2]), os.path.abspath(sys.argv[3]))
    else:
        print(__doc__)
        return 2
    print(f"a10_data {cmd}: провалов {len(FAILED)}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
```
