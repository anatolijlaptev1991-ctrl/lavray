# A10. Установщик NSIS: тихая установка, обновление поверх, удаление

| Поле | Значение |
|---|---|
| ID | A10 |
| Слой | авто |
| Время | 10–15 минут |
| Зависимости | A06 (ассеты скачаны и сверены: `assets\0.4.0` и `assets\0.3.0`), `01-ENVIRONMENT.md`, разделы 3–7. Выполняется **последовательно**, после A04 и A11 (группа S в `00-README.md`) |
| Опасность | **установка**: пишет в `C:\Program Files\LAVRay`, `HKLM\...\Uninstall`, меню «Пуск», `HKCU\...\Run` (имитация автозапуска). Только тестовый ПК |

## Цель

Проверить жизненный цикл установленной версии без окна: тихая установка прежней версии 0.3.0, обновление поверх неё версией 0.4.0 с сохранением данных и автозапуска, удаление с проверкой «хвостов». Покрывает: «Установка поверх 0.3.0 сохраняет серверы, подписки, настройки и автозапуск» (заметки к выпуску 0.4.0), хук удаления `shell/windows/hooks.nsh` (автозапуск снимается при удалении, но не при обновлении), раздел «Установка» требований плана Ф3.0 (поведение `/S`, per-machine установка, установка более старой версии), бюджет размера установщика.

Внимание: поведение тихого NSIS-установщика Tauri при запущенном приложении и при понижении версии в плане помечено как неисследованное (риск «Поведение тихой установки NSIS неизвестно»). Шаги 8 и 9 поэтому только **фиксируют** наблюдение и не влияют на итог файла.

## Предусловия

- **Тестовый ПК подтверждён**: `C:\lavray-test\TESTPC_OK` существует; иначе итог `BLOCKED`.
- PowerShell запущен **от имени администратора** (установщик на уровне компьютера). Проверка в шаге 1; без прав итог `BLOCKED` (тихая установка не может показать запрос UAC).
- Скачаны `assets\0.3.0` и `assets\0.4.0` с проверенными суммами (A06). Без релиза 0.4.0 — `BLOCKED`.
- LAVRay и `lavray-core` не запущены (страж из `01-ENVIRONMENT.md`).
- Программа не установлена до теста. Если установлена, итог `BLOCKED`: тест не должен затирать чужую установку.

## Безопасность

Меняется: каталог `C:\Program Files\LAVRay`, ветка `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall` (запись установщика), ярлык в меню «Пуск», значение `LAVRay` в `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (создаётся тестом, чтобы проверить сохранение автозапуска), файл `%APPDATA%\LAVRay\a10-marker.txt`. Системный прокси, TUN и порты не затрагиваются, приложение в основной части не запускается. Откат — шаг 10 и раздел «Откат»; в конце установленной программы быть не должно.

## Шаги

1. Права, маркер, исходное состояние.

```powershell
. C:\lavray-test\env.ps1
if (-not (Test-Path C:\lavray-test\TESTPC_OK)) { 'BLOCKED: нет маркера TESTPC_OK'; return }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
"администратор: $isAdmin"
$pf = Join-Path $env:ProgramFiles 'LAVRay'
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
"процессы LAVRay:              " + [bool](Get-Process LAVRay, lavray-core -ErrorAction SilentlyContinue)
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

   Ожидается: `администратор: True`, оба установщика есть, «запись об установке до теста: False», «каталог программы до теста: False», «процессы LAVRay: False», автозапуск `(нет)`. Иначе итог `BLOCKED` с названием причины.

2. Тихая установка прежней версии 0.3.0 (в этом файле `-Wait` ждёт завершения; сам NSIS при `/S` не показывает окон).

```powershell
$p = Start-Process -FilePath $setupOld -ArgumentList '/S' -Wait -PassThru
"установка 0.3.0: код $($p.ExitCode)"
Get-LavrayUninstall | Format-List
Get-ChildItem $pf -Recurse | Select-Object FullName, Length | Format-Table -AutoSize | Out-String -Width 200
```

   Ожидается: код `0`; запись об установке с `Version = 0.3.0`; файлы `LAVRay.exe`, `binaries\lavray-core.exe`, `uninstall.exe` в `C:\Program Files\LAVRay`. Запомните точное имя ключа реестра и значение `Uninstall` (путь к удалителю): они нужны для шага 9.

3. Состав установки: файлы, ярлык в меню «Пуск».

```powershell
foreach ($f in 'LAVRay.exe', 'binaries\lavray-core.exe', 'uninstall.exe') {
  $path = Join-Path $pf $f
  '{0,-28} {1,10} байт  {2}' -f $f, $(if (Test-Path $path) { (Get-Item $path).Length } else { -1 }), $(if (Test-Path $path) { (Get-FileHash $path -Algorithm SHA256).Hash.Substring(0, 16) } else { '' })
}
$lnk = Get-ChildItem "$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter 'LAVRay*.lnk' -ErrorAction SilentlyContinue
$lnk | Select-Object FullName
if ($lnk) {
  $sh = New-Object -ComObject WScript.Shell
  "цель ярлыка: " + $sh.CreateShortcut($lnk[0].FullName).TargetPath
}
```

   Ожидается: три файла размером больше нуля (отрицательный размер — файла нет); найден хотя бы один ярлык `LAVRay*.lnk`, цель — `C:\Program Files\LAVRay\LAVRay.exe`. Точный путь ярлыка (общее меню «Пуск» или меню пользователя) запишите в отчёт: он зависит от настроек сборки установщика и в коде репозитория не зафиксирован.

4. Подготовка данных и автозапуска (имитация пользователя 0.3.0).

```powershell
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$marker = Join-Path $dataDir 'a10-marker.txt'
Set-Content -LiteralPath $marker -Value ('a10-' + [guid]::NewGuid().ToString()) -Encoding utf8
$markerHash = (Get-FileHash $marker -Algorithm SHA256).Hash
$runValue = '"' + (Join-Path $pf 'LAVRay.exe') + '" --tray'
Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'LAVRay' -Value $runValue
(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run').LAVRay
```

   Ожидается: значение автозапуска вида `"C:\Program Files\LAVRay\LAVRay.exe" --tray` (так же его пишет сама программа, см. `shell/src/autostart.rs`).

5. Обновление: установка 0.4.0 поверх 0.3.0.

```powershell
$p = Start-Process -FilePath $setupNew -ArgumentList '/S' -Wait -PassThru
"обновление до 0.4.0: код $($p.ExitCode)"
$u = @(Get-LavrayUninstall)
"записей об установке: $($u.Count)"
$u | Format-List
```

   Ожидается: код `0`; ровно **одна** запись об установке, `Version = 0.4.0` (две записи — прежняя не заменена, `FAIL`).

6. После обновления: файлы той же версии, что в portable; данные и автозапуск сохранены.

```powershell
$portable = $env:LAVRAY_PORTABLE
foreach ($pair in @(@('LAVRay.exe', 'LAVRay.exe'), @('binaries\lavray-core.exe', 'binaries\lavray-core.exe'))) {
  $a = (Get-FileHash (Join-Path $pf $pair[0]) -Algorithm SHA256).Hash
  $b = (Get-FileHash (Join-Path $portable $pair[1]) -Algorithm SHA256).Hash
  '{0,-26} совпадает с portable: {1}' -f $pair[0], ($a -eq $b)
}
"маркер данных на месте и не изменён: " + ((Test-Path $marker) -and ((Get-FileHash $marker -Algorithm SHA256).Hash -eq $markerHash))
$runAfter = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).LAVRay
"автозапуск сохранён: " + ($runAfter -eq $runValue)
"ярлык на месте: " + [bool](Get-ChildItem "$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter 'LAVRay*.lnk' -ErrorAction SilentlyContinue)
"установщик NSIS не оставил задач планировщика: " + (-not [bool](Get-ScheduledTask -TaskName 'LAVRay*' -ErrorAction SilentlyContinue))
```

   Ожидается: обе строки «совпадает с portable: True» (установщик и ZIP собираются из одних и тех же файлов; расхождение хэшей — `WARN`, запишите оба хэша), маркер на месте и не изменён, автозапуск сохранён (заметки 0.4.0: «Установка поверх 0.3.0 сохраняет серверы, подписки, настройки и автозапуск»; хук удаления не должен срабатывать при обновлении), ярлык на месте, задач планировщика нет (мы их не создавали).

7. Размер установщика и подпись (справочно, повторяет A06).

```powershell
'{0:N1} МБ' -f ((Get-Item $setupNew).Length / 1MB)
(Get-AuthenticodeSignature $setupNew).Status
```

   Ожидается: не больше 25 МБ; статус `NotSigned` (см. A06, шаг 10).

8. Наблюдение: повторный запуск `/S` при **запущенном** приложении (план Ф3.0). Запись результата, не критерий.

```powershell
$app = Start-Process -FilePath (Join-Path $pf 'LAVRay.exe') -ArgumentList '--tray' -PassThru
Start-Sleep -Seconds 15
"приложение работает до установки: " + [bool](Get-Process -Id $app.Id -ErrorAction SilentlyContinue)
$p = Start-Process -FilePath $setupNew -ArgumentList '/S' -Wait -PassThru
"повторная установка при запущенном приложении: код $($p.ExitCode)"
Start-Sleep -Seconds 10
"процесс LAVRay жив после установки: " + [bool](Get-Process LAVRay -ErrorAction SilentlyContinue)
"процессов lavray-core: " + @(Get-Process lavray-core -ErrorAction SilentlyContinue).Count
Get-Process LAVRay, lavray-core -ErrorAction SilentlyContinue | Stop-Process -Force
```

   Запишите все четыре значения в таблицу «Наблюдения» отчёта (установщик остановил приложение, оставил его, завершился с ошибкой, перезапустил его). Любой исход допустим для этого шага. Если приложение в `--tray` не стартовало (процесса нет уже до установки), запишите это отдельным наблюдением: нужна диагностика запуска.

9. Наблюдение: установка прежней версии поверх новой (понижение, нужно для отката в плане Ф3.0), затем возврат к 0.4.0 для чистого удаления.

```powershell
$p = Start-Process -FilePath $setupOld -ArgumentList '/S' -Wait -PassThru
$v = (@(Get-LavrayUninstall) | ForEach-Object Version) -join ','
"понижение до 0.3.0: код $($p.ExitCode); версия в реестре: $v"
$p = Start-Process -FilePath $setupNew -ArgumentList '/S' -Wait -PassThru
$v = (@(Get-LavrayUninstall) | ForEach-Object Version) -join ','
"возврат к 0.4.0: код $($p.ExitCode); версия в реестре: $v"
```

   Запишите коды и версии в «Наблюдения». Критерий только один: после возврата ровно одна запись об установке и `Version = 0.4.0`.

10. Удаление и «хвосты».

```powershell
$u = @(Get-LavrayUninstall)[0]
$u.Uninstall
$un = Join-Path $pf 'uninstall.exe'
$p = Start-Process -FilePath $un -ArgumentList '/S' -PassThru
# удалитель NSIS может перезапустить себя из временного каталога и вернуть управление сразу: ждём результат опросом
$sw = [Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt 90 -and ((Test-Path (Join-Path $pf 'LAVRay.exe')) -or @(Get-LavrayUninstall).Count -gt 0)) { Start-Sleep -Seconds 2 }
"удаление завершено за: $([int]$sw.Elapsed.TotalSeconds) с"
"LAVRay.exe удалён:            " + (-not (Test-Path (Join-Path $pf 'LAVRay.exe')))
"binaries\lavray-core.exe удалён: " + (-not (Test-Path (Join-Path $pf 'binaries\lavray-core.exe')))
"каталог программы удалён:     " + (-not (Test-Path $pf))
"запись об установке удалена:  " + (-not [bool](Get-LavrayUninstall))
"ярлыков нет:                  " + (-not [bool](Get-ChildItem "$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter 'LAVRay*.lnk' -ErrorAction SilentlyContinue))
"автозапуск Run снят:          " + (-not [bool]((Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).LAVRay))
"задач планировщика нет:       " + (-not [bool](Get-ScheduledTask -TaskName 'LAVRay', 'LAVRay-*' -ErrorAction SilentlyContinue))
"процессов нет:                " + (-not [bool](Get-Process LAVRay, lavray-core -ErrorAction SilentlyContinue))
"данные пользователя сохранены (политика): " + ((Test-Path $marker) -and ((Get-FileHash $marker -Algorithm SHA256).Hash -eq $markerHash))
```

    Политика «хвостов» (источник: `shell/windows/hooks.nsh` и каталог данных `%APPDATA%\LAVRay`, который создаёт сама программа вне установщика):

    | Что | После удаления |
    |---|---|
    | Файлы в `C:\Program Files\LAVRay`, сам каталог | удалены |
    | Запись в `Uninstall`, ярлык «Пуск» | удалены |
    | Значение `HKCU\...\Run\LAVRay`, задачи планировщика `LAVRay`, `LAVRay-<SID>` | удалены (хук `NSIS_HOOK_POSTUNINSTALL`, не при обновлении) |
    | `%APPDATA%\LAVRay` (серверы, подписки, настройки, `ui-state.json`) | **сохраняются**: удалитель их не знает и пользователь не должен терять данные |
    | `%APPDATA%\io.github.anatolijlaptev1991-ctrl.lavray`, `%LOCALAPPDATA%\io.github.anatolijlaptev1991-ctrl.lavray` (профиль WebView2) | допустимы; удалитель Tauri стирает их только по явной галочке «Удалить данные приложения»; поведение `/S` для этой галочки запишите в «Наблюдения» |

    Ожидается: все строки `True`. Каждая `False` строка про файлы, запись, ярлык, автозапуск, задачи или процессы — `FAIL`.

11. Что осталось после удаления, для отчёта.

```powershell
Get-ChildItem $env:ProgramFiles -Filter 'LAVRay*' -ErrorAction SilentlyContinue
Get-ChildItem $dataDir, $webv[0], $webv[1] -ErrorAction SilentlyContinue | Select-Object FullName, Length -First 20
```

    Ожидается: в `Program Files` ничего; из пользовательских данных — только каталоги из таблицы политики.

## Критерии PASS/FAIL

| № | Критерий | Как проверить |
|---|---|---|
| К1 | Шаг 1: права администратора, маркер, чистое исходное состояние | значения |
| К2 | Шаг 2: тихая установка 0.3.0, код 0, запись `Version = 0.3.0`, три файла | вывод |
| К3 | Шаг 3: найден ярлык «Пуск» с целью `LAVRay.exe` | вывод |
| К4 | Шаг 5: обновление, код 0, **одна** запись, `Version = 0.4.0` | вывод |
| К5 | Шаг 6: установленные `LAVRay.exe` и `lavray-core.exe` совпадают с portable (при расхождении `WARN`) | `True` |
| К6 | Шаг 6: данные (маркер) и автозапуск сохранены, ярлык на месте | `True` |
| К7 | Шаг 7: установщик не больше 25 МБ | значение |
| К8 | Шаг 9: после возврата одна запись и `Version = 0.4.0` | вывод |
| К9 | Шаг 10: все строки удаления `True`, включая сохранение данных пользователя | вывод |

Шаги 8 и 9 (кроме К8) — наблюдения, их исход не меняет итог.

## Что собрать

`results\A10\`: вывод шагов 2, 3, 5, 6, 10 целиком; таблица «Наблюдения» (шаги 8–9: коды установщика, был ли убит процесс, версия после понижения, судьба каталогов WebView2); путь ярлыка; имя ключа `Uninstall`.

## Откат / уборка

Обязателен. Выполняется всегда, даже если шаги прошли или тест остановлен на середине.

```powershell
Get-Process LAVRay, lavray-core -ErrorAction SilentlyContinue | Stop-Process -Force
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
if (-not $dataExisted -and (Test-Path $dataDir)) { Remove-Item -Recurse -Force $dataDir }
else { Remove-Item -LiteralPath (Join-Path $dataDir 'a10-marker.txt') -Force -ErrorAction SilentlyContinue }
foreach ($d in $webv) { if (-not $webvBefore[$d] -and (Test-Path $d)) { Remove-Item -Recurse -Force $d } }
"запись об установке: " + [bool](Get-LavrayUninstall)
"каталог программы:   " + (Test-Path $pf)
"автозапуск Run:      " + [bool]((Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).LAVRay)
```

Ожидается: три строки `False`. Если запись или каталог остались, а удалитель не отработал, удалите вручную `C:\Program Files\LAVRay` и ключ `Uninstall`, найденный `Get-LavrayUninstall` (`Remove-Item -Recurse -Force <Key>`), и запишите это как дефект `major` (удалитель не убрал установку). Если машина виртуальная, откат снимка надёжнее.

Каталоги данных и профиля WebView2 удаляются только если их не было до теста (значения сохранены в шаге 1).

## Отчёт

`results/A10.md` по `templates/REPORT.md`: статусы 11 шагов, К1–К9, таблица «Наблюдения». Провал К4 (две записи) и К6 (потеря данных или автозапуска при обновлении) — `critical`; К9 (оставленные файлы, запись, автозапуск, задачи) — `major`; остальные — `major`/`minor` по вашей оценке.
