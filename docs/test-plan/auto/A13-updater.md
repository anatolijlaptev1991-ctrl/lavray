# A13. Центр обновлений (T-75): цепочка доверия, загрузка, отказы и `verify-artifact` на тестовом корне

| Поле | Значение |
|---|---|
| ID | A13 |
| Слой | авто |
| Время | 4–6 минут при первом запуске (три сборки Go около 2–3 минут), потом около 40 секунд + тесты репозитория 1 минута |
| Зависимости | `01-ENVIRONMENT.md`, разделы 4–7; Go и Python 3.12 (модуль `sqlite3`); клон репозитория `LAVRAY_SRC` на коммите выпуска `<TAG>` (по умолчанию `v0.9.0`; на момент написания — `main` на `80be1e9`, ветка `feat/T-75-updates`, `d98e3d8`, то же дерево). Группа P (нагружает процессор при сборке) |
| Опасность | нет: ядра и «зеркала» работают на loopback в `C:\lavray-test\tmp\A13`; ключи тестовые и лежат вне git-дерева; системный прокси, TUN, реестр, установка и хранилище сертификатов Windows не затрагиваются |

`<TAG>` — тег выпуска под тестом; по умолчанию `v0.9.0` (единый итоговый тег плана доработки). В `env.ps1` это переменная `LAVRAY_REF`.

## Цель

Проверить подсистему обновлений ядра так, как её видит клиент, но **без настоящего корня доверия**. Корень доверия в репозитории — заглушка (`core/cmd/lavray-core/root.json`, поле `placeholder`): владелец ещё не провёл церемонию ключей, и релизные сборки отвечают на `CheckUpdates` причиной `not_configured`. Поэтому тестировщик сам создаёт **тестовые** ключи и тестовый корень, собирает ядро с этим корнем и поднимает локальные зеркала метаданных. Проверяются `CheckUpdates`, `DownloadUpdates`, `ApplyUpdates`, `Rollback`, `GetUpdateState`, `VerifyLocalUpdate` по Connect JSON, подкоманда `lavray-core verify-artifact` и защита цепочки доверия:

- состояние «не настроено» и то, что при нём сеть не трогается;
- успешный путь: проверка, загрузка в `<данные>\updates\staging`, повторная проверка при применении (анти-TOCTOU), подмена файла в staging;
- отказы с причиной (`bad_signature`, `expired`, `clock_skew`, `serial_rollback`, `wrong_product`, `wrong_channel`, `root_rotation`, `artifact_role_missing`, `mirror_unreachable`) и то, что ни один из них не обновляет «последнюю успешную проверку»;
- монотонные счётчики и служебные ключи `update.*`, которые клиент не может ни прочитать, ни записать;
- ротация корня `1 → 2` с отзывом ключей timestamp и manifest, подделка корня, корень без роли `artifact`, подложенный в каталог данных корень;
- транспорт: молчащее зеркало, ответ больше лимита 8 МиБ, редиректы, обрыв и докачка (`Range`), одна загрузка за раз;
- подмена и неверная подпись установщика, «Установить из файла» (`VerifyLocalUpdate`), коды выхода `verify-artifact`;
- доступ агентского токена и каналы stable и beta.

Что здесь **не** проверяется: запуск установщика с UAC, остановка ядра и снятие системного прокси оболочкой, watchdog и откат прошлым установщиком, замок `installer_locked` — всё это оболочка, файл `M12-update-center.md` (нужна виртуальная машина). Настоящий выпуск с настоящим корнем — тоже `M12`, после церемонии ключей владельца.

## Предусловия

- Python 3.12, Go, Git; `LAVRAY_SRC` из `env.ps1`.
- Каталог `C:\lavray-test\tmp\A13` **не** лежит внутри git-дерева (`updsign` отказывается читать и писать ключи внутри репозитория). Шаг 1 это проверяет.
- Свободны произвольные порты loopback; порт 2080 не используется.

## Безопасность

Ключи, корень и «релизы» тестовые: они созданы командой `updsign genkey` на этом ПК и годятся только для проверки. Настоящие ключи выпуска, настоящий `root.json` и секреты CI сюда не передаются. Файл `core/cmd/lavray-core/root.json` в клоне не меняется: ядро с тестовым корнем собирается флагом компоновщика `-X main.rootJSONB64=…` (он сильнее файла), а ядро-заглушка — из копии дерева с заглушкой, поэтому проверка не зависит от того, лежит ли в клоне уже настоящий корень. Ничего не публикуется; зеркала слушают только `127.0.0.1`.

Зеркала работают по обычному HTTP: адреса bootstrap-источников, вшитые в ядро флагом `-X main.bootstrapURLs=…`, схемой не проверяются, а подписанный `sources.json` обязан содержать только `https` и в тесте указывает на закрытый порт 1 (быстрый отказ). Поэтому тест не нуждается в сертификатах и не трогает хранилище сертификатов. Правила «только `https`» для подписанных источников и редиректа `https → http` проверяют Go-тесты (шаг 4: `TestHttpsToHttpRedirectRejected`); скрипт проверяет, что любой редирект зеркала отвергается и цель редиректа не запрашивается.

## Шаги

1. Каталоги и проверка, что они вне git.

   ```powershell
   . C:\lavray-test\env.ps1
   $t = 'C:\lavray-test\tmp\A13'
   New-Item -ItemType Directory -Force -Path $t, C:\lavray-test\results\A13 | Out-Null
   git -C $t rev-parse --is-inside-work-tree 2>&1 | Select-Object -First 1
   Test-Path (Join-Path $env:LAVRAY_SRC 'core\cmd\lavray-core\root.json')
   ```

   Ожидается: первая строка — `fatal: not a git repository…` (если напечатано `true`, перенесите `tmp\A13` из git-дерева), вторая — `True`.

2. Сохраните скрипт из раздела «Скрипт `a13_updater.py`» как `C:\lavray-test\tmp\A13\a13_updater.py` и запустите:

   ```powershell
   python -I "$t\a13_updater.py" (Join-Path $env:LAVRAY_SRC 'core') "$t\run" 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A13\run.txt | Select-Object -Last 12
   "a13 exit=$LASTEXITCODE"
   $res = Get-Content "$t\run\a13-result.json" -Raw | ConvertFrom-Json
   "проверок: $($res.total), провалов: $($res.failed), наблюдений: $($res.warnings)"
   $res.checks | Where-Object { -not $_.pass } | Select-Object id, warn, detail | Format-Table -AutoSize -Wrap
   ```

   Ожидается: `a13 exit=0`, `провалов: 0`. Эталон на `main` `80be1e9`: 144 проверки и 2 `WARN`:

   | `WARN` | Что наблюдается | Серьёзность |
   |---|---|---|
   | `3.manifest_swapped_after_timestamp.has_reason_code` | если манифест подменён другим, тоже верно подписанным (его sha256 закреплён в timestamp), ядро отвечает `failed_precondition: updates: sha256 не совпал: manifest не совпал с timestamp` **без** причины и без заголовка `Lavray-Update-Reason`; интерфейс покажет общий текст «Обновление не прошло проверку.» | `minor` |
   | `4.settings.update_channel_is_validated` | `SetSettings` принимает `update.channel = nightly` (любую строку); неизвестный канал читается как `stable`. Служебные ключи `update.*` при этом не принимаются | `minor` |

   Если нужен только повтор без пересборки, достаточно запустить тот же скрипт ещё раз: кэш сборки Go сократит подготовку до секунд. Если скрипт остановили на середине, завершите оставшиеся ядра: `Get-Process lavray-core-test, lavray-core-placeholder -ErrorAction SilentlyContinue | Stop-Process -Force`.

3. Статические тесты workflow подписи (12 тестов; запрет `${{ inputs.* }}` внутри `run:`, права, Environment для ключей, порядок шагов `meta-refresh` и `meta-resign`):

   ```powershell
   Set-Location $env:LAVRAY_SRC
   python -B -m unittest scripts/tests/test_signing_workflows.py -v 2>&1 | Select-Object -Last 6
   Set-Location C:\lavray-test
   ```

   Ожидается: `Ran 12 tests` и `OK`. Ключ `-B` не даёт Python писать `__pycache__` в клон.

4. Тесты репозитория, которые скрипт не повторяет:

   ```powershell
   Set-Location (Join-Path $env:LAVRAY_SRC 'core')
   go test -count=1 ./internal/updates/... ./cmd/updsign/ 2>&1 | Select-String -Pattern '^(ok|FAIL|---)'
   go test -count=1 -run 'Update|Verify|Rollback|Staging|Root' ./internal/api/ ./cmd/lavray-core/ 2>&1 | Select-String -Pattern '^(ok|FAIL|---)'
   go test -count=1 -v -run '^(TestHttpsToHttpRedirectRejected|TestRedirectCap|TestRotationSkipRejected|TestRotationRequiresNewKeys|TestRevokedKeyRejectedAfterTwoRotations|TestRotationFailsClosedWhenASourceIsSilent|TestShortStreamKeepsPartAndResumes|TestDownloadRejectsOversizedAsset|TestTimestampClockSkewTolerance|TestGeoZipSlipRejected|TestGeoSymlinkEntryRejected)$' ./internal/updates/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
   go test -count=1 -v -run '^(TestEmbeddedRootValid|TestPlaceholderRootIsNotConfigured|TestNoPrivateKeysInTree)$' ./cmd/lavray-core/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
   Set-Location C:\lavray-test
   ```

   Ожидается: строки `ok` для пакетов `internal/updates`, `cmd/updsign`, `internal/api`, `cmd/lavray-core`, для каждого перечисленного имени `--- PASS`. `TestEmbeddedRootValid` на заглушке проходит (корня ещё нет); после церемонии ключей он потребует срок корня больше 180 дней. Тест, которого нет в выбранном коммите (`testing: warning: no tests to run`), запишите в отклонения и сверьтесь с `go test -list 'Update|Root|Rotat' ./internal/...`.

5. Что проверяет скрипт (для отчёта и поиска причины; идентификаторы начинаются с номера раздела):

   | Раздел | Проверки | Коды и значения |
   |---|---|---|
   | 0. Стенд | `updsign` собран; тестовые ключи `k1`, `k2` (root), `t1`, `t2` (timestamp), `r1`, `r2` (manifest и sources), `a1` (artifact) и чужие `wr`, `wa`, `x1`; корни 1, 2 (ротация, отзыв `t1` и `r1`), 3 (без роли `artifact`), подделка 2; два ядра: с тестовым корнем и с заглушкой | — |
   | 1. Не настроено | ядро-заглушка: `CheckUpdates` → `not_configured` («updates not configured (no trust root in this build)»), `DownloadUpdates` — то же с заголовком, `GetUpdateState` без времени проверки и версии корня, `VerifyLocalUpdate` → `not_configured`; зеркала при этом **не получили ни одного запроса** | `400 failed_precondition`, причина `not_configured` |
   | 2. Успешный путь | до проверки времени проверки нет, фаза `IDLE`; `CheckUpdates` находит `0.9.1` (текущая `0.9.0`), актив совпадает с опубликованным файлом (`sha256`, длина), время проверки и рабочий источник заполнены, заметки возвращаются как данные (HTML-теги не вырезаются и не исполняются: интерфейс обязан показать их текстом, см. M12); `GetUpdateState`: корень 1, `serial` 100, `timestampFresh`; загрузка: `progress … verified`, файл `<sha256>-<имя>` внутри staging с точным содержимым и `.minisig` рядом, `.part` нет, фаза `DOWNLOADED`; `ApplyUpdates` → `verified`, `readyForRestart = "app"`; подмена байта в staging → `verifyFailed: sha256_mismatch`, фаза `FAILED`; `ApplyUpdates(CORE)` → `failed_precondition`; `Rollback(APP)` → `failed_precondition` («откат выполняет оболочка»), без компонента → `invalid_argument`, `PRESETS` → `unimplemented`; `Apply` без загрузки → `not_staged` | коды рядом с проверкой |
   | 3. Метаданные | подпись манифеста или timestamp чужим ключом → `bad_signature`; просроченные timestamp и manifest → `expired`; timestamp с `expires` на 200 часов вперёд (так выглядят часы ПК, отставшие больше чем на сутки) → `clock_skew`; чужой `product` → `wrong_product`; манифест beta в слоте stable → `wrong_channel`; подписанная более старая или та же версия → ответ `200` без обновления (время проверки обновляется); правка байта timestamp или manifest → `bad_signature`; подмена манифеста другим подписанным → `failed_precondition` (sha256 из timestamp); мусор вместо timestamp → `failed_precondition`; `sources.json` с чужой подписью игнорируется | `400 failed_precondition`, причина в начале сообщения и в заголовке `Lavray-Update-Reason` |
   | 4. Счётчики и настройки | первый `serial` 200 сохраняется; `serial` 100 → `serial_rollback`, максимум остаётся 200; `timestamp.version` ниже сохранённой → `serial_rollback`; новее — принимается; `SetSettings` всех служебных ключей `update.*` (значения `1` и `99999999999`) → `200` с пустым `acceptedKeys`, счётчики не изменились, следующий релиз принимается; `GetSettings` их не отдаёт (только `update.channel` и `update.auto_check`); `update.auto_check` принимается; свежесть: при сдвиге `update.last_checked_at` на 3 суток `timestampFresh = true`, на 8 и 31 — `false` | — |
   | 5. Ротация | корень 2 (подписан `k1` и `k2`, отозваны `t1` и `r1`) принят, версия корня 2, **счётчики сброшены** для отозванных ключей (`serial` 5 принят после 301), принятый корень лежит в `updates\roots\2.root.json` и переживает перезапуск; метаданные отозванными ключами → `bad_signature`; «корень 2», подписанный только чужим `x1` → `root_rotation` и не сохраняется; корень 3 без роли `artifact` → `artifact_role_missing`; подложенный в каталог данных чужой корень не принимается | `400 failed_precondition` |
   | 6. Транспорт | зеркало 2 выключено → `503 unavailable`, причина `mirror_unreachable: 127.0.0.1:<порт>` (называется только молчащее зеркало), время проверки не меняется, после возвращения зеркала проверка проходит; оба зеркала выключены — названы оба, `DownloadUpdates` → `unavailable` с заголовком причины; `timestamp.json` больше 8 МиБ → `unavailable`, оба зеркала опрошены, без «нет обновлений»; редирект `timestamp.json` и установщика отвергается, цель редиректа не запрашивается; обрыв на 40 % → докачка запросом `Range: bytes=…` и успешная проверка; файл короче заявленного → `verifyFailed: truncated`, готового файла нет (`.part` остаётся для докачки: наблюдение); вторая загрузка во время первой → `aborted` | см. таблицу |
   | 7. Установщик | подмена одного байта при верных метаданных → `verifyFailed: sha256_mismatch`, staging пуст, фаза `FAILED`; манифест верен, а minisign установщика подписан чужим ключом → проверка проходит, загрузка → `verifyFailed: bad_signature`, staging пуст | — |
   | 8. Из файла | подпись рядом, верная → `valid`; без `.minisig` подпись берётся из манифеста (онлайн) и сохраняется рядом; чужой ключ, правка байта, та же версия, более старая, чужая платформа, чужой продукт, подпись больше 4 КиБ → `valid = false` с текстом ошибки; путь вне staging, `..\..`, пустой путь, подпись вне staging → `400 invalid_argument` | — |
   | 9. `verify-artifact` | верно: код 0 и JSON `{"sha256","version"}`; правка байта, чужой ключ, та же версия, более старая без `--allow-older`, чужая платформа, нет файла, корень-заглушка → код 1; с `--allow-older` старая версия → 0; без аргументов → 2; принятая ротация в `<данные>\updates\roots` используется; подложенный чужой корень (с ключом установщика злоумышленника) подпись злоумышленника **не** принимает | коды выхода 0, 1, 2 |
   | 10. Агент | в режимах `read` и `control` `GetUpdateState` доступен, `CheckUpdates`, `DownloadUpdates`, `ApplyUpdates`, `Rollback`, `VerifyLocalUpdate` → `403 permission_denied`, сеть не затронута | — |
   | 11. Каналы | при опубликованной только beta stable ничего не находит; beta находит `0.9.2-beta.1`; `serial` ведутся раздельно; `update.channel = beta` принимается, и `DownloadUpdates` скачивает beta | — |

## Критерии PASS/FAIL

| № | Критерий | Шаг |
|---|---|---|
| К1 | `a13 exit=0`, провалов 0 (допустимы два `WARN` из таблицы шага 2) | 2 |
| К2 | При заглушке корня везде `not_configured`, зеркала не получают запросов | 2 (`1.*`) |
| К3 | Успешный путь: проверка, загрузка, повторная проверка, подмена в staging ловится | 2 (`2.*`) |
| К4 | Каждый неверный документ даёт свою причину и не обновляет время проверки; подмена принята ни в одном случае | 2 (`3.*`, `7.*`) |
| К5 | Счётчики монотонны, служебные ключи `update.*` не принимаются и не читаются | 2 (`4.*`) |
| К6 | Ротация принимается только от прежнего порога ключей, отзыв сбрасывает счётчики, подделка и корень без `artifact` отвергаются | 2 (`5.*`) |
| К7 | Молчащее зеркало названо, лимит размера, редиректы, докачка, одна загрузка | 2 (`6.*`) |
| К8 | «Из файла» и `verify-artifact` отвергают любое отклонение, коды выхода 0, 1, 2 | 2 (`8.*`, `9.*`) |
| К9 | Агент не может проверять, скачивать, применять, откатывать | 2 (`10.*`) |
| К10 | 12 тестов workflow подписи проходят | 3 |
| К11 | Go-тесты шага 4 проходят | 4 |

## Что собрать

`results\A13\run.txt`, копия `a13-result.json`, выводы шагов 3 и 4. Каталоги `run\keys` (тестовые ключи), `run\site` и `run\*\data` **не** копировать: ключи тестовые, но привычка не выносить ключи из каталога важна.

## Откат / уборка

```powershell
Get-Process lavray-core-test, lavray-core-placeholder -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'C:\lavray-test\*' } | Stop-Process -Force
Remove-Item -Recurse -Force C:\lavray-test\tmp\A13
Test-Path C:\lavray-test\tmp\A13
```

Ожидается `False`. Клон `LAVRAY_SRC` не менялся: `git -C $env:LAVRAY_SRC status --short` пуст.

## Отчёт

`results/A13.md` по `templates/REPORT.md`: шаги 1–4, К1–К11. Серьёзность: принятое обновление с неверной подписью, подменой, откатом serial или чужим корнем (К4, К6, К8), доступ агента (К9), служебный ключ `update.*`, принятый от клиента (К5) — `critical`; «нет обновлений» вместо `not_configured` или `mirror_unreachable` (К2, К7), файл в staging после отказа (К7, К4), счётчики не сброшены после отзыва ключей (К6) — `major`; `WARN` из таблицы шага 2 — `minor`.

## Скрипт `a13_updater.py`

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A13: центр обновлений (T-75) на настоящем ядре, loopback и ТЕСТОВОМ корне доверия, который создаётся здесь же.

Что делает: собирает updsign, создаёт ключи вне git-дерева, подписывает тестовый root, собирает два ядра
(с тестовым корнем и с заглушкой корня из репозитория), поднимает два «зеркала» метаданных на loopback
(обычный HTTP: адреса bootstrap-источников не проверяются на https, а подписанный sources.json содержит только
недостижимые https-адреса) и проходит UpdateService по Connect JSON и подкоманду `verify-artifact`.
Настоящего корня доверия и настоящих ключей выпуска здесь нет и быть не должно.

Запуск: python -I a13_updater.py <каталог core репозитория> <каталог результатов>
Код выхода: 0 - все проверки PASS, 1 - есть FAIL. Итог: <каталог>/a13-result.json.
"""
import base64
import hashlib
import http.server
import json
import os
import platform
import secrets
import shutil
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
CORE_SRC, OUT = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.makedirs(OUT, exist_ok=True)
RESULTS = []
VERSION_PKG = "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/version.Version"
APP_VERSION = "0.9.0"
ASSET = "windows-arm64" if "arm" in platform.machine().lower() else "windows-x64"
PRODUCT = "lavray-windows"
NL = chr(10)


def check(cid, ok, detail="", warn=False):
    """warn=True: наблюдение, при провале печатается WARN и итог файла не меняется."""
    RESULTS.append({"id": cid, "pass": bool(ok), "warn": bool(warn and not ok), "detail": str(detail)[:300]})
    print(("PASS " if ok else ("WARN " if warn else "FAIL ")) + cid + ("" if ok else " :: " + str(detail)[:220]), flush=True)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def run(cmd, cwd=None, env=None, timeout=900):
    p = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, timeout=timeout)
    return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def sha_hex(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    with open(path, "rb") as f:
        return f.read()


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data if isinstance(data, bytes) else data.encode("utf-8"))


# ------------------------------------------------------------------ стенд: ключи, корни, сборка ----

KEYS = os.path.join(OUT, "keys")  # вне git-дерева: updsign отказывается читать и писать ключи внутри репозитория
SITE = os.path.join(OUT, "site")
META = os.path.join(SITE, "meta")
UPDSIGN = os.path.join(OUT, "updsign.exe")
P1, P2 = free_port(), free_port()
BOOT = [f"http://127.0.0.1:{P1}/meta", f"http://127.0.0.1:{P2}/meta"]
PUB = {}


def ups(*args, expect=0):
    rc, out, err = run([UPDSIGN, *args])
    if rc != expect:
        raise RuntimeError(f"updsign {' '.join(args[:2])}: код {rc}: {err.strip()[:200]}")
    return out


def kf(name):
    return os.path.join(KEYS, name + ".sec")


def genkey(role, name):
    ups("genkey", "-role", role, "-out", kf(name), "-pub", kf(name) + ".pub.json")
    PUB[name] = json.loads(read(kf(name) + ".pub.json"))["root_key"]


def root_json(path, version, keyids, roles, signers, prev=None, expect=0, ttl_days=730):
    """keyids - id ключей, roles - {роль: [id]}; signers - id ключей, которыми подписывается корень."""
    draft = {"type": "root", "version": version,
             "expires": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + ttl_days * 86400)),
             "keys": {k: PUB[k] for k in keyids}, "roles": {r: {"keyids": ids, "threshold": 1} for r, ids in roles.items()}}
    dpath = path + ".draft.json"
    write(dpath, json.dumps(draft))
    cmd = ["root"]
    for s in signers:
        cmd += ["-key", f"{s}=file:{kf(s)}"]
    cmd += ["-in", dpath, "-out", path]
    if prev:
        cmd += ["-prev", prev]
    return ups(*cmd, expect=expect)


ROLES_V1 = {"root": ["k1"], "timestamp": ["t1"], "manifest": ["r1"], "sources": ["r1"], "artifact": ["a1"]}
ROLES_V2 = {"root": ["k2"], "timestamp": ["t2"], "manifest": ["r2"], "sources": ["r2"], "artifact": ["a1"]}


def setup_keys_and_roots():
    shutil.rmtree(KEYS, ignore_errors=True)
    for role, name in (("root", "k1"), ("root", "k2"), ("timestamp", "t1"), ("timestamp", "t2"), ("manifest", "r1"), ("manifest", "r2"),
                       ("artifact", "a1"), ("manifest", "wr"), ("artifact", "wa"), ("root", "x1")):
        genkey(role, name)
    root_json(os.path.join(KEYS, "root1.json"), 1, ["k1", "t1", "r1", "a1"], ROLES_V1, ["k1"])
    # ротация 1 -> 2: подписана прежним (k1) и новым (k2) ключами; отзываются t1 и r1
    root_json(os.path.join(KEYS, "root2.json"), 2, ["k2", "t2", "r2", "a1"], ROLES_V2, ["k1", "k2"], prev=os.path.join(KEYS, "root1.json"))
    # корень 3 без роли artifact: клиент обязан отказать (fail-closed)
    roles3 = {r: ids for r, ids in ROLES_V2.items() if r != "artifact"}
    root_json(os.path.join(KEYS, "root3.json"), 3, ["k2", "t2", "r2"], roles3, ["k2"], prev=os.path.join(KEYS, "root2.json"))
    # подделка: «корень 2», подписанный только чужим ключом x1, без участия прежнего корня
    forged_roles = {"root": ["x1"], "timestamp": ["t1"], "manifest": ["r1"], "sources": ["r1"], "artifact": ["a1"]}
    root_json(os.path.join(KEYS, "root2-forged.json"), 2, ["x1", "t1", "r1", "a1"], forged_roles, ["x1"])
    # та же подделка, но с ключом установщика злоумышленника (wa) в роли artifact
    forged_art = dict(forged_roles, artifact=["wa"])
    root_json(os.path.join(KEYS, "root2-forged-artifact.json"), 2, ["x1", "t1", "r1", "wa"], forged_art, ["x1"])


def build(name, root_path):
    exe = os.path.join(OUT, name)
    flags = [f"-X main.bootstrapURLs={','.join(BOOT)}", f"-X {VERSION_PKG}={APP_VERSION}"]
    if root_path:
        flags.append("-X main.rootJSONB64=" + base64.b64encode(read(root_path)).decode())
    env = dict(os.environ, CGO_ENABLED="0")
    src = CORE_SRC
    if not root_path:
        # ядро-заглушка собирается из копии дерева с заглушкой root.json: так проверка не зависит от того, лежит ли в
        # репозитории уже настоящий корень (после церемонии ключей)
        src = os.path.join(OUT, "core-placeholder-src")
        shutil.rmtree(src, ignore_errors=True)
        shutil.copytree(CORE_SRC, src, ignore=shutil.ignore_patterns(".git", "*.exe"))
        write(os.path.join(src, "cmd", "lavray-core", "root.json"), '{"placeholder": true}')
    rc, out, err = run(["go", "build", "-ldflags", " ".join(flags), "-o", exe, "./cmd/lavray-core"], cwd=src, env=env)
    if rc != 0:
        raise RuntimeError(f"go build {name}: {err.strip()[:300]}")
    return exe


# ------------------------------------------------------------------ зеркало метаданных ----

class Site:
    """Два HTTP-«зеркала» одного каталога site/. Поведение управляется полем behave; запросы пишутся в log."""

    def __init__(self):
        self.behave = {}
        self.log = []
        self.servers = {}

    def start(self, port):
        site = self

        class H(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def do_GET(self):
                site.handle(self, port)

        srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
        srv.daemon_threads = True
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.servers[port] = srv

    def stop(self, port):
        srv = self.servers.pop(port, None)
        if srv:
            srv.shutdown()
            srv.server_close()

    def hits(self, suffix):
        return [h for h in self.log if h[1].split("?")[0].endswith(suffix)]

    def handle(self, h, port):
        path = h.path
        rng = h.headers.get("Range", "")
        self.log.append((port, path, rng))
        base = path.split("?")[0]
        for suffix, loc in self.behave.get("redirect", {}).items():
            if base.endswith(suffix):
                h.send_response(302)
                h.send_header("Location", loc.format(port=port))
                h.send_header("Content-Length", "0")
                h.end_headers()
                return
        local = os.path.join(SITE, *[p for p in base.split("/") if p])
        if not os.path.isfile(local):
            h.send_response(404)
            h.send_header("Content-Length", "0")
            h.end_headers()
            return
        data = read(local)
        for suffix, size in self.behave.get("oversize", {}).items():
            if base.endswith(suffix):
                data = data + b" " * size
        for suffix, fn in self.behave.get("transform", {}).items():
            if base.endswith(suffix):
                data = fn(data)
        start = 0
        status = 200
        if rng.startswith("bytes=") and rng.endswith("-"):
            start = int(rng[6:-1])
            status = 206
        body = data[start:]
        h.send_response(status)
        h.send_header("Content-Length", str(len(body)))
        if status == 206:
            h.send_header("Content-Range", f"bytes {start}-{len(data) - 1}/{len(data)}")
        h.end_headers()
        cut = self.behave.get("cut_first")
        if cut and base.endswith(cut["suffix"]) and not rng and not cut.get("done"):
            cut["done"] = True
            h.wfile.write(body[: int(len(body) * cut["fraction"])])
            h.wfile.flush()
            h.close_connection = True
            h.connection.close()
            return
        slow = self.behave.get("slow")
        try:
            if slow and base.endswith(slow["suffix"]):
                step = slow["chunk"]
                for i in range(0, len(body), step):
                    h.wfile.write(body[i:i + step])
                    h.wfile.flush()
                    time.sleep(slow["delay"])
            else:
                h.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass


SITE_SRV = Site()


# ------------------------------------------------------------------ публикация ----

INSTALLER = secrets.token_bytes(300_000)
NOTES = {"ru": "Тест: что нового " + chr(60) + "img src=x onerror=alert(1)" + chr(62) + NL + "вторая строка", "en": "Test notes"}


def release(root=None, ver="0.9.1", serial=100, tsv=1000, channel="stable", file_channel=None, product=PRODUCT, mkey="r1", mkid="r1",
            akey="a1", tkey="t1", tkid="t1", ts_ttl="168h", m_ttl="720h", installer=None, extra_roots=(), skey=None, keep=False):
    """Пересобирает site/meta: корень, sources.json, manifest-<канал>.json, timestamp.json и установщик."""
    if not keep:
        shutil.rmtree(META, ignore_errors=True)
    os.makedirs(META, exist_ok=True)
    shutil.copyfile(root or os.path.join(KEYS, "root1.json"), os.path.join(META, "root.json"))
    for name, src in extra_roots:
        shutil.copyfile(src, os.path.join(META, name))
    inst = installer if installer is not None else INSTALLER
    fname = f"v{ver}/LAVRay-{ver}-x64-setup.exe"
    ipath = os.path.join(META, *fname.split("/"))
    write(ipath, inst)
    sdraft = os.path.join(KEYS, "sources.draft.json")
    write(sdraft, json.dumps({"type": "sources", "version": 1, "artifacts": ["https://127.0.0.1:1/dl"], "metadata": ["https://127.0.0.1:1/meta"]}))
    ups("sources", "-key", f"file:{kf(skey or mkey)}", "-keyid", mkid, "-in", sdraft, "-out", os.path.join(META, "sources.json"))
    npath = os.path.join(KEYS, "notes.json")
    write(npath, json.dumps(NOTES, ensure_ascii=False))
    out = os.path.join(META, f"manifest-{file_channel or channel}.json")
    ups("manifest", "-key", f"file:{kf(mkey)}", "-keyid", mkid, "-artifact-key", f"file:{kf(akey)}", "-product", product, "-channel", channel,
        "-version", ver, "-serial", str(serial), "-asset", f"{ASSET}={fname}={ipath}", "-notes", npath, f"-expires={m_ttl}", "-out", out)
    ups("timestamp", "-key", f"file:{kf(tkey)}", "-keyid", tkid, "-dir", META, "-out", os.path.join(META, "timestamp.json"),
        "-version", str(tsv), f"-expires={ts_ttl}")
    return {"installer": ipath, "sha256": sha_hex(inst), "length": len(inst), "name": fname}


def sign_artifact(path, key, version, serial=100, channel="stable", product=PRODUCT, platform_key=None, out=None):
    out = out or path + ".minisig"
    ups("artifact", "-key", f"file:{kf(key)}", "-file", path, "-product", product, "-platform", platform_key or ASSET,
        "-channel", channel, "-version", version, "-serial", str(serial), "-out", out)
    return out


# ------------------------------------------------------------------ ядро ----

class Core:
    def __init__(self, exe, name, data=None, fresh=True):
        self.exe, self.name = exe, name
        self.root = os.path.join(OUT, name)
        if fresh and data is None:
            shutil.rmtree(self.root, ignore_errors=True)
        self.data = data or os.path.join(self.root, "data")
        os.makedirs(self.data, exist_ok=True)
        self.tok, self.agent = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        self.p = None

    def start(self):
        self.p = subprocess.Popen([self.exe, "serve", "--listen-socket", "127.0.0.1:0", "--data", self.data], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, self.name + "-stderr.log"), "ab"))
        self.p.stdin.write((self.tok + NL + self.agent + NL).encode())
        self.p.stdin.flush()
        self.base = "http://" + self.p.stdout.readline().decode().split()[1].replace("tcp://", "")
        self.rpc("SettingsService", "SetSettings", {"values": {"update.auto_check": {"boolValue": False}}})
        return self

    def rpc(self, svc, method, body=None, token=None):
        """Возвращает (HTTP-статус, тело, заголовки)."""
        req = urllib.request.Request(f"{self.base}/lavray.v1.{svc}/{method}", data=json.dumps(body or {}).encode(),
                                     headers={"Authorization": "Bearer " + (token or self.tok), "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else {}), r.headers
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace")
            try:
                return e.code, json.loads(raw), e.headers
            except ValueError:
                return e.code, raw, e.headers

    def stream(self, svc, method, body=None, timeout=120, token=None):
        """Server-stream connect+json: все кадры до конца потока; возвращает (кадры, конечный кадр)."""
        raw = json.dumps(body or {}).encode()
        env = b"\x00" + struct.pack(">I", len(raw)) + raw
        req = urllib.request.Request(f"{self.base}/lavray.v1.{svc}/{method}", data=env, headers={
            "Authorization": "Bearer " + (token or self.tok), "Content-Type": "application/connect+json", "Connect-Protocol-Version": "1"})
        frames, end = [], {}
        try:
            r = urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            return [], {"http": e.code}
        while True:
            head = r.read(5)
            if len(head) < 5:
                break
            flags, n = head[0], struct.unpack(">I", head[1:])[0]
            payload = r.read(n)
            msg = json.loads(payload) if payload else {}
            if flags & 2:
                end = msg
                break
            frames.append(msg)
        r.close()
        return frames, end

    def stop(self):
        try:
            self.p.stdin.close()
            self.p.wait(timeout=30)
        except Exception:  # noqa: BLE001
            self.p.kill()
            self.p.wait()

    # --- обёртки ---
    def check(self, channel="UPDATE_CHANNEL_STABLE"):
        return self.rpc("UpdateService", "CheckUpdates", {"channel": channel})

    def state(self):
        st, r, _ = self.rpc("UpdateService", "GetUpdateState", {})
        return r if st == 200 else {}

    def download(self):
        return self.stream("UpdateService", "DownloadUpdates", {})

    def staging(self):
        return os.path.join(self.data, "updates", "staging")


def reason(r):
    """(код Connect, причина из начала сообщения, заголовок причины)."""
    st, body, hdr = r
    msg = body.get("message", "") if isinstance(body, dict) else ""
    return body.get("code") if isinstance(body, dict) else None, msg.split(":", 1)[0] if ":" in msg else "", hdr.get("Lavray-Update-Reason") if hdr else None


def kinds(frames):
    return [next((k for k in f if k != "tsMs"), "?") for f in frames]


def staged_files(c):
    d = c.staging()
    return sorted(os.listdir(d)) if os.path.isdir(d) else []


# ================================================================== сценарии ====

X = {}  # exe, exe_ph, story_data


def R(name):
    return os.path.join(KEYS, name)


def ms_now():
    return int(time.time() * 1000)


def chain(c):
    return c.state().get("chainState", {})


def last_checked(c):
    return int(c.state().get("lastCheckedAtMs", 0) or 0)


def inside(path, root):
    return os.path.normcase(os.path.abspath(path)).startswith(os.path.normcase(os.path.abspath(root)) + os.sep)


def set_state(data, key, value):
    import sqlite3
    con = sqlite3.connect(os.path.join(data, "lavray.db"))
    try:
        con.execute("UPDATE settings SET value = ? WHERE key = ?", (str(value), key))
        con.commit()
    finally:
        con.close()


def sec1_not_configured():
    """1. Заглушка корня из репозитория: причина not_configured везде, сеть не трогается."""
    release()
    SITE_SRV.log.clear()
    c = Core(X["exe_ph"], "s1").start()
    r = c.check()
    check("1.check.not_configured", r[0] == 400 and reason(r) == ("failed_precondition", "not_configured", "not_configured"), (r[0], reason(r)))
    check("1.check.message_says_no_trust_root", "no trust root" in r[1].get("message", ""), r[1])
    frames, end = c.download()
    check("1.download.not_configured", not frames and end.get("error", {}).get("code") == "failed_precondition" and
          end.get("metadata", {}).get("Lavray-Update-Reason") == ["not_configured"], end)
    st = c.rpc("UpdateService", "GetUpdateState", {})
    check("1.state.never_checked", st[0] == 200 and "lastCheckedAtMs" not in st[1] and not st[1].get("chainState", {}).get("rootVersion"), st[1])
    os.makedirs(c.staging(), exist_ok=True)
    fake = os.path.join(c.staging(), "0" * 64 + "-x.exe")
    write(fake, b"x")
    r = c.rpc("UpdateService", "VerifyLocalUpdate", {"installerPath": fake})
    check("1.verify_local.not_configured", r[0] == 400 and reason(r)[1] == "not_configured", reason(r))
    check("1.network_untouched", not SITE_SRV.log, SITE_SRV.log[:2])
    c.stop()


def sec2_success_path():
    """2. Тестовый корень: проверка, загрузка, повторная проверка при применении."""
    info = release()
    c = Core(X["exe"], "s2").start()
    st = c.rpc("UpdateService", "GetUpdateState", {})
    check("2.state.before", st[0] == 200 and "lastCheckedAtMs" not in st[1] and st[1]["components"][0]["phase"] == "PHASE_IDLE", st[1])
    r = c.check()
    av = r[1].get("available", [{}])[0] if r[0] == 200 else {}
    asset = av.get("manifest", {}).get("assets", {}).get(ASSET, {})
    check("2.check.update_found", r[0] == 200 and av.get("availableVersion") == "0.9.1" and av.get("currentVersion") == "0.9.0" and
          av.get("component") == "UPDATE_COMPONENT_APP" and r[1].get("currentAppVersion") == "0.9.0", (r[0], str(r[1])[:150]))
    check("2.check.asset_matches_published_file", asset.get("sha256") == info["sha256"] and asset.get("length") == str(info["length"]), asset)
    check("2.check.last_checked_and_source", abs(last_checked(c) - ms_now()) < 120_000 and r[1].get("workingSources", [""])[0].startswith("http://127.0.0.1:"),
          (r[1].get("lastCheckedAtMs"), r[1].get("workingSources")))
    check("2.check.notes_are_plain_data", "<img src=x onerror=alert(1)>" in av.get("notes", {}).get("ru", ""), av.get("notes"))
    ch = chain(c)
    check("2.state.chain", ch.get("rootVersion") == 1 and ch.get("maxSerial", {}).get("stable") == "100" and ch.get("timestampFresh") is True, ch)
    frames, end = c.download()
    k = kinds(frames)
    ver = next((f["verified"] for f in frames if "verified" in f), {})
    check("2.download.event_order", k and k[0] == "progress" and k[-1] == "verified" and set(k[:-1]) == {"progress"} and end == {}, (k, end))
    check("2.download.progress_total", frames and frames[0]["progress"].get("totalBytes") == str(info["length"]), frames[:1])
    sp = ver.get("stagedPath", "")
    check("2.download.staged_inside_staging", sp and inside(sp, c.staging()) and os.path.basename(sp).startswith(info["sha256"] + "-"), sp)
    check("2.download.staged_bytes_equal_published", sp and os.path.isfile(sp) and read(sp) == INSTALLER and ver.get("sha256") == info["sha256"], ver.get("sha256"))
    names = staged_files(c)
    check("2.download.staging_has_installer_and_signature_only", len(names) == 2 and any(n.endswith(".exe.minisig") for n in names) and not any(n.endswith(".part") for n in names), names)
    comp = c.state().get("components", [{}])[0]
    check("2.state.downloaded", comp.get("phase") == "PHASE_DOWNLOADED" and comp.get("stagedVersion") == "0.9.1", comp)
    frames, end = c.stream("UpdateService", "ApplyUpdates", {})
    check("2.apply.ready_for_restart", kinds(frames) == ["verified", "readyForRestart"] and frames[-1]["readyForRestart"] == "app" and end == {}, (kinds(frames), end))
    check("2.apply.phase_ready_for_restart", c.state()["components"][0]["phase"] == "PHASE_READY_FOR_RESTART", c.state()["components"][0])
    # подмена файла в staging после проверки: повторная проверка при применении ловит её
    with open(sp, "r+b") as f:
        f.seek(10)
        b = f.read(1)
        f.seek(10)
        f.write(bytes([b[0] ^ 1]))
    frames, end = c.stream("UpdateService", "ApplyUpdates", {})
    check("2.apply.tampered_staging_rejected", kinds(frames) == ["verifyFailed"] and frames[0]["verifyFailed"]["reason"] == "sha256_mismatch", (kinds(frames), end))
    comp = c.state()["components"][0]
    check("2.apply.phase_failed_after_tamper", comp.get("phase") == "PHASE_FAILED" and "staging" in comp.get("error", ""), comp)
    # прочие ветки Apply и Rollback
    frames, end = c.stream("UpdateService", "ApplyUpdates", {"components": ["UPDATE_COMPONENT_CORE"]})
    check("2.apply.core_component_precondition", end.get("error", {}).get("code") == "failed_precondition", end)
    r = c.rpc("UpdateService", "Rollback", {"component": "UPDATE_COMPONENT_APP"})
    check("2.rollback.app_is_for_the_shell", r[0] == 400 and r[1]["code"] == "failed_precondition" and "update_rollback" in r[1]["message"], r[1])
    r = c.rpc("UpdateService", "Rollback", {"component": "UPDATE_COMPONENT_UNSPECIFIED"})
    check("2.rollback.unspecified.invalid_argument", r[0] == 400 and r[1]["code"] == "invalid_argument", r[1])
    r = c.rpc("UpdateService", "Rollback", {"component": "UPDATE_COMPONENT_PRESETS"})
    check("2.rollback.presets.unimplemented", r[0] == 501 and r[1]["code"] == "unimplemented", r[1])
    c.stop()
    c = Core(X["exe"], "s2b").start()
    frames, end = c.stream("UpdateService", "ApplyUpdates", {})
    check("2.apply.without_download.not_staged", not frames and end.get("error", {}).get("code") == "failed_precondition" and
          end.get("metadata", {}).get("Lavray-Update-Reason") == ["not_staged"], end)
    c.stop()


def sec3_metadata_negatives():
    """3. Неверные метаданные: у каждого случая своя причина; ни один не обновляет last_checked_at."""
    cases = [
        ("manifest_signed_by_wrong_key", dict(mkey="wr", mkid="r1"), "bad_signature"),
        ("timestamp_signed_by_wrong_key", dict(tkey="t2", tkid="t1"), "bad_signature"),
        ("timestamp_expired", dict(ts_ttl="-1h"), "expired"),
        ("manifest_expired", dict(m_ttl="-1h"), "expired"),
        ("timestamp_from_the_future_is_clock_skew", dict(ts_ttl="200h"), "clock_skew"),
        ("foreign_product", dict(product="lavray-linux"), "wrong_product"),
        ("beta_manifest_in_stable_slot", dict(channel="beta", file_channel="stable"), "wrong_channel"),
    ]
    for name, kw, want in cases:
        release(**kw)
        c = Core(X["exe"], "s3").start()
        r = c.check()
        check(f"3.{name}.{want}", r[0] == 400 and reason(r) == ("failed_precondition", want, want), (r[0], reason(r)))
        check(f"3.{name}.last_checked_untouched", last_checked(c) == 0, c.state())
        c.stop()
    for name, ver in (("older_signed_version", "0.8.0"), ("same_version", "0.9.0")):
        release(ver=ver)
        c = Core(X["exe"], "s3").start()
        r = c.check()
        check(f"3.{name}.no_update_but_checked", r[0] == 200 and not r[1].get("available") and last_checked(c) > 0, (r[0], str(r[1])[:120]))
        c.stop()
    # правка подписанных документов
    release()
    ts = bytearray(read(os.path.join(META, "timestamp.json")))
    ts[ts.index(b"version") + 12] ^= 1
    write(os.path.join(META, "timestamp.json"), bytes(ts))
    c = Core(X["exe"], "s3").start()
    r = c.check()
    check("3.timestamp_byte_flipped.bad_signature", reason(r)[1] == "bad_signature", reason(r))
    c.stop()
    release()
    mf = bytearray(read(os.path.join(META, "manifest-stable.json")))
    mf[mf.index(b"serial") + 9] ^= 1
    write(os.path.join(META, "manifest-stable.json"), bytes(mf))
    c = Core(X["exe"], "s3").start()
    r = c.check()
    check("3.manifest_byte_flipped.bad_signature", reason(r)[1] == "bad_signature", reason(r))
    c.stop()
    # подмена манифеста другим, тоже верно подписанным (mix-and-match): его sha256 закреплён в timestamp
    release(serial=90, tsv=1000)
    other = read(os.path.join(META, "manifest-stable.json"))
    release(serial=100, tsv=1000)
    write(os.path.join(META, "manifest-stable.json"), other)
    c = Core(X["exe"], "s3").start()
    r = c.check()
    check("3.manifest_swapped_after_timestamp.rejected", r[0] == 400 and r[1].get("code") == "failed_precondition" and "sha256" in r[1].get("message", ""), r[1])
    check("3.manifest_swapped_after_timestamp.has_reason_code", reason(r)[2] is not None, "у ответа нет причины (заголовок Lavray-Update-Reason): интерфейс покажет общий текст", warn=True)
    c.stop()
    release()
    write(os.path.join(META, "timestamp.json"), b"not json")
    c = Core(X["exe"], "s3").start()
    r = c.check()
    check("3.garbage_timestamp.rejected", r[0] == 400 and r[1].get("code") == "failed_precondition" and last_checked(c) == 0, r[1])
    c.stop()
    # sources.json с чужой подписью игнорируется: проверка идёт по bootstrap-списку сборки
    release(skey="wr")
    c = Core(X["exe"], "s3").start()
    r = c.check()
    check("3.sources_signed_by_wrong_key_ignored", r[0] == 200 and r[1].get("available"), (r[0], str(r[1])[:100]))
    c.stop()


def sec4_state():
    """4. Монотонные счётчики, служебные ключи update.*, свежесть проверки."""
    release(serial=200, tsv=2000)
    c = Core(X["exe"], "s4").start()
    r = c.check()
    check("4.serial.first_check_saves_maximum", r[0] == 200 and chain(c).get("maxSerial", {}).get("stable") == "200", chain(c))
    release(serial=100, tsv=2001)
    r = c.check()
    check("4.serial.rollback_rejected", r[0] == 400 and reason(r) == ("failed_precondition", "serial_rollback", "serial_rollback"), reason(r))
    check("4.serial.maximum_kept_after_rejection", chain(c).get("maxSerial", {}).get("stable") == "200", chain(c))
    release(serial=300, tsv=1500)
    r = c.check()
    check("4.timestamp.version_rollback_rejected", reason(r)[1] == "serial_rollback" and "timestamp.version" in r[1].get("message", ""), r[1])
    release(serial=300, tsv=2002)
    r = c.check()
    check("4.serial.newer_accepted", r[0] == 200 and chain(c).get("maxSerial", {}).get("stable") == "300", chain(c))
    # клиент не может ни понизить, ни повысить счётчики через SetSettings
    keys = ["update.root_json", "update.root_version", "update.timestamp_version", "update.serial_stable", "update.serial_beta", "update.last_checked_at", "update.last_url"]
    for value in ("1", "99999999999"):
        r = c.rpc("SettingsService", "SetSettings", {"values": {k: {"stringValue": value} for k in keys}})
        check(f"4.settings.internal_keys_not_accepted.{value}", r[0] == 200 and not r[1].get("acceptedKeys"), r[1])
    check("4.settings.counters_unchanged", chain(c).get("maxSerial", {}).get("stable") == "300" and chain(c).get("rootVersion") == 1, chain(c))
    release(serial=301, tsv=2003)
    r = c.check()
    check("4.settings.next_release_still_accepted", r[0] == 200 and chain(c).get("maxSerial", {}).get("stable") == "301", (r[0], chain(c)))
    r = c.rpc("SettingsService", "GetSettings", {"keys": keys + ["update.channel", "update.auto_check"]})
    got = set(r[1].get("values", {})) if r[0] == 200 else set()
    check("4.settings.internal_keys_not_readable", got == {"update.channel", "update.auto_check"}, sorted(got))
    r = c.rpc("SettingsService", "SetSettings", {"values": {"update.channel": {"stringValue": "nightly"}}})
    check("4.settings.update_channel_is_validated", r[0] == 400, "update.channel принимает любое значение (" + str(r[1])[:60] + "): неизвестный канал читается как stable", warn=True)
    c.rpc("SettingsService", "SetSettings", {"values": {"update.channel": {"stringValue": "stable"}}})
    r = c.rpc("SettingsService", "SetSettings", {"values": {"update.auto_check": {"boolValue": True}}})
    check("4.settings.auto_check_accepted", r[0] == 200 and r[1].get("acceptedKeys") == ["update.auto_check"], r[1])
    c.rpc("SettingsService", "SetSettings", {"values": {"update.auto_check": {"boolValue": False}}})
    # свежесть: GetUpdateState сообщает время последней проверки; старше 7 суток - timestampFresh = false
    c.stop()
    for days, fresh in ((3, True), (8, False), (31, False)):
        set_state(c.data, "update.last_checked_at", ms_now() - days * 86_400_000)
        c = Core(X["exe"], "s4", data=c.data, fresh=False).start()
        s = c.state()
        age = (ms_now() - int(s.get("lastCheckedAtMs", 0))) / 86_400_000
        check(f"4.freshness.{days}_days", abs(age - days) < 0.1 and bool(s.get("chainState", {}).get("timestampFresh")) is fresh, (round(age, 2), s.get("chainState")))
        c.stop()
    X["story_data"] = c.data


def sec5_rotation():
    """5. Ротация корня 1 -> 2 с отзывом ключей t1 и r1, подделка, корень без роли artifact."""
    data = X["story_data"]
    release(root=R("root2.json"), serial=5, tsv=10, mkey="r2", mkid="r2", tkey="t2", tkid="t2", extra_roots=[("2.root.json", R("root2.json"))])
    c = Core(X["exe"], "s5", data=data, fresh=False).start()
    r = c.check()
    ch = chain(c)
    check("5.rotation.accepted", r[0] == 200 and ch.get("rootVersion") == 2, (r[0], ch))
    check("5.rotation.counters_reset_for_revoked_keys", ch.get("maxSerial", {}).get("stable") == "5", ch)
    rd = os.path.join(data, "updates", "roots")
    roots = sorted(os.listdir(rd)) if os.path.isdir(rd) else []
    check("5.rotation.accepted_root_stored_as_chain", roots == ["2.root.json"], roots)
    c.stop()
    c = Core(X["exe"], "s5", data=data, fresh=False).start()
    check("5.rotation.survives_restart", chain(c).get("rootVersion") == 2, chain(c))
    release(root=R("root2.json"), serial=6, tsv=11, extra_roots=[("2.root.json", R("root2.json"))])  # метаданные старыми ключами t1/r1
    r = c.check()
    check("5.rotation.revoked_keys_rejected", reason(r) == ("failed_precondition", "bad_signature", "bad_signature"), reason(r))
    c.stop()
    release(root=R("root1.json"), extra_roots=[("2.root.json", R("root2-forged.json"))])
    c = Core(X["exe"], "s5f").start()
    r = c.check()
    check("5.forged_root.root_rotation", reason(r) == ("failed_precondition", "root_rotation", "root_rotation"), reason(r))
    rd = os.path.join(c.data, "updates", "roots")
    check("5.forged_root.not_stored", not os.path.isdir(rd) or not os.listdir(rd), "подделка сохранена на диск")
    c.stop()
    release(root=R("root3.json"), serial=7, tsv=12, mkey="r2", mkid="r2", tkey="t2", tkid="t2",
            extra_roots=[("2.root.json", R("root2.json")), ("3.root.json", R("root3.json"))])
    c = Core(X["exe"], "s5g").start()
    r = c.check()
    check("5.root_without_artifact_role.fail_closed", reason(r) == ("failed_precondition", "artifact_role_missing", "artifact_role_missing"), reason(r))
    c.stop()
    # подложенный в каталог данных «корень 2», подписанный чужим ключом, в цепочку не встаёт
    release()
    c = Core(X["exe"], "s5h").start()
    c.stop()
    os.makedirs(os.path.join(c.data, "updates", "roots"), exist_ok=True)
    shutil.copyfile(R("root2-forged.json"), os.path.join(c.data, "updates", "roots", "2.root.json"))
    c = Core(X["exe"], "s5h", data=c.data, fresh=False).start()
    r = c.check()
    check("5.planted_root_on_disk.not_trusted", r[0] == 200 and chain(c).get("rootVersion") in (None, 0, 1), (r[0], chain(c)))
    c.stop()


def sec6_transport():
    """6. Транспорт: молчащее зеркало, лимит размера, редиректы, докачка, одна загрузка за раз."""
    info = release()
    fname = "LAVRay-0.9.1-x64-setup.exe"
    c = Core(X["exe"], "s6").start()
    SITE_SRV.stop(P2)
    r = c.check()
    msg = r[1].get("message", "") if isinstance(r[1], dict) else ""
    check("6.mirror_down.unavailable_names_the_host", r[0] == 503 and reason(r) == ("unavailable", "mirror_unreachable", "mirror_unreachable") and
          f"127.0.0.1:{P2}" in msg and f"127.0.0.1:{P1}" not in msg, (r[0], msg))
    check("6.mirror_down.last_checked_untouched", last_checked(c) == 0, c.state())
    SITE_SRV.start(P2)
    r = c.check()
    check("6.mirror_down.recovers_when_mirror_returns", r[0] == 200 and r[1].get("available"), (r[0], str(r[1])[:100]))
    SITE_SRV.stop(P1)
    SITE_SRV.stop(P2)
    r = c.check()
    msg = r[1].get("message", "") if isinstance(r[1], dict) else ""
    check("6.mirror_down.both_hosts_named", r[0] == 503 and f"127.0.0.1:{P1}" in msg and f"127.0.0.1:{P2}" in msg, msg)
    frames, end = c.download()
    check("6.mirror_down.download_unavailable_with_reason", not frames and end.get("error", {}).get("code") == "unavailable" and
          end.get("metadata", {}).get("Lavray-Update-Reason") == ["mirror_unreachable"], end)
    SITE_SRV.start(P1)
    SITE_SRV.start(P2)
    c.stop()
    # ответ больше лимита (8 МиБ) не обрезается молча
    SITE_SRV.behave["oversize"] = {"timestamp.json": 9 * 1024 * 1024}
    SITE_SRV.log.clear()
    c = Core(X["exe"], "s6b").start()
    r = c.check()
    check("6.oversize_metadata.rejected", r[0] == 503 and r[1].get("code") == "unavailable" and last_checked(c) == 0, (r[0], str(r[1])[:100]))
    check("6.oversize_metadata.both_mirrors_were_asked", {h[0] for h in SITE_SRV.hits("timestamp.json")} >= {P1, P2}, SITE_SRV.hits("timestamp.json"))
    SITE_SRV.behave["oversize"] = {}
    r = c.check()
    check("6.oversize_metadata.control_without_oversize_passes", r[0] == 200, (r[0], str(r[1])[:100]))
    # редирект (допустим только https; на loopback зеркала http, поэтому любой редирект отвергается)
    SITE_SRV.behave["redirect"] = {"timestamp.json": "http://127.0.0.1:{port}/meta/timestamp.json?r=1"}
    SITE_SRV.log.clear()
    c2 = Core(X["exe"], "s6c").start()
    r = c2.check()
    check("6.redirect_metadata.rejected", r[0] == 503 and r[1].get("code") == "unavailable" and last_checked(c2) == 0, (r[0], str(r[1])[:100]))
    check("6.redirect_metadata.target_never_requested", not [h for h in SITE_SRV.log if "r=1" in h[1]], [h for h in SITE_SRV.log if "r=1" in h[1]])
    SITE_SRV.behave["redirect"] = {fname: "http://127.0.0.1:{port}/meta/v0.9.1/" + fname + "?r=1"}
    SITE_SRV.log.clear()
    c3 = Core(X["exe"], "s6d").start()
    frames, end = c3.download()
    check("6.redirect_artifact.not_followed", "verified" not in kinds(frames) and not [h for h in SITE_SRV.log if "r=1" in h[1]] and not [n for n in staged_files(c3) if n.endswith(".exe")],
          (kinds(frames), end, staged_files(c3)))
    SITE_SRV.behave["redirect"] = {}
    c2.stop()
    c3.stop()
    c.stop()
    # обрыв посреди загрузки: докачка с места обрыва (Range) и успешная проверка
    SITE_SRV.behave["cut_first"] = {"suffix": fname, "fraction": 0.4}
    SITE_SRV.log.clear()
    c = Core(X["exe"], "s6e").start()
    frames, end = c.download()
    ranges = [h[2] for h in SITE_SRV.hits(fname) if h[2]]
    check("6.resume.verified_after_cut", kinds(frames)[-1:] == ["verified"] and end == {}, (kinds(frames), end))
    check("6.resume.second_request_has_range", ranges and ranges[0].startswith("bytes=") and int(ranges[0][6:-1]) > 0, ranges)
    check("6.resume.result_equals_published", frames and read(frames[-1]["verified"]["stagedPath"]) == INSTALLER, "")
    c.stop()
    SITE_SRV.behave["cut_first"] = None
    # короткое тело: файл меньше заявленного в манифесте
    SITE_SRV.behave["transform"] = {fname: lambda b: b[:-100]}
    c = Core(X["exe"], "s6f").start()
    frames, end = c.download()
    check("6.short_body.truncated", kinds(frames)[-1:] == ["verifyFailed"] and frames[-1]["verifyFailed"]["reason"] == "truncated", (kinds(frames), frames[-1:]))
    check("6.short_body.no_finished_installer", not [n for n in staged_files(c) if n.endswith(".exe") or n.endswith(".minisig")], staged_files(c))
    check("6.short_body.part_kept_for_resume", [n for n in staged_files(c) if n.endswith(".part")], staged_files(c), warn=True)
    c.stop()
    SITE_SRV.behave["transform"] = {}
    # одна загрузка за раз
    SITE_SRV.behave["slow"] = {"suffix": fname, "chunk": 30000, "delay": 0.4}
    c = Core(X["exe"], "s6g").start()
    first = {}
    t = threading.Thread(target=lambda: first.update(r=c.download()))
    t.start()
    time.sleep(1.2)
    frames, end = c.download()
    t.join()
    check("6.concurrent_download.second_is_aborted", not frames and end.get("error", {}).get("code") == "aborted", end)
    check("6.concurrent_download.first_completes", kinds(first["r"][0])[-1:] == ["verified"], kinds(first["r"][0]))
    SITE_SRV.behave["slow"] = None
    c.stop()


def sec7_artifact_negatives():
    """7. Подмена и неверная подпись установщика: отказ с причиной, в staging ничего не остаётся."""
    fname = "LAVRay-0.9.1-x64-setup.exe"
    release()
    SITE_SRV.behave["transform"] = {fname: lambda b: b[:1000] + bytes([b[1000] ^ 1]) + b[1001:]}
    c = Core(X["exe"], "s7").start()
    r = c.check()
    check("7.tampered_byte.check_still_passes", r[0] == 200, "метаданные верны, подмена только в файле")
    frames, end = c.download()
    check("7.tampered_byte.sha256_mismatch", kinds(frames)[-1:] == ["verifyFailed"] and frames[-1]["verifyFailed"]["reason"] == "sha256_mismatch", (kinds(frames), frames[-1:]))
    check("7.tampered_byte.staging_is_empty", staged_files(c) == [], staged_files(c))
    comp = c.state()["components"][0]
    check("7.tampered_byte.phase_failed", comp.get("phase") == "PHASE_FAILED", comp)
    c.stop()
    SITE_SRV.behave["transform"] = {}
    release(akey="wa")  # манифест подписан верно, а minisign установщика - чужим ключом
    c = Core(X["exe"], "s7b").start()
    r = c.check()
    check("7.wrong_artifact_key.check_passes", r[0] == 200, "подпись установщика проверяется при загрузке")
    frames, end = c.download()
    check("7.wrong_artifact_key.bad_signature", kinds(frames)[-1:] == ["verifyFailed"] and frames[-1]["verifyFailed"]["reason"] == "bad_signature", (kinds(frames), frames[-1:]))
    check("7.wrong_artifact_key.staging_is_empty", staged_files(c) == [], staged_files(c))
    c.stop()


def sec8_local_verify():
    """8. VerifyLocalUpdate («Установить из файла»): только staging, подпись roли artifact, продукт, платформа, версия."""
    release()
    c = Core(X["exe"], "s8").start()
    os.makedirs(c.staging(), exist_ok=True)
    work = os.path.join(OUT, "s8work")
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    inst = os.path.join(work, "LAVRay-0.9.1-x64-setup.exe")
    write(inst, INSTALLER)
    sig = sign_artifact(inst, "a1", "0.9.1")
    X["local_sig"], X["local_inst"] = sig, inst

    def stage(name, data, sigfile=None):
        p = os.path.join(c.staging(), sha_hex(data) + "-" + name)
        write(p, data)
        if sigfile:
            shutil.copyfile(sigfile, p + ".minisig")
        return p

    def verify(p, **extra):
        return c.rpc("UpdateService", "VerifyLocalUpdate", dict({"installerPath": p}, **extra))

    r = verify(stage("good.exe", INSTALLER, sig))
    check("8.good_signature_next_to_installer", r[0] == 200 and r[1].get("valid") is True and r[1]["manifest"]["version"] == "0.9.1" and r[1]["manifest"]["product"] == PRODUCT, r[1])
    p = stage("nosig.exe", INSTALLER)
    r = verify(p)
    check("8.no_signature_file_uses_online_manifest", r[0] == 200 and r[1].get("valid") is True and os.path.isfile(p + ".minisig"), r[1])
    cases = [
        ("wrong_artifact_key", INSTALLER, sign_artifact(inst, "wa", "0.9.1", out=os.path.join(work, "wa.minisig")), "keyid"),
        ("tampered_installer", INSTALLER[:50] + bytes([INSTALLER[50] ^ 1]) + INSTALLER[51:], sig, "подпись"),
        ("same_version_as_installed", INSTALLER, sign_artifact(inst, "a1", "0.9.0", out=os.path.join(work, "same.minisig")), "не новее"),
        ("older_version", INSTALLER, sign_artifact(inst, "a1", "0.8.0", out=os.path.join(work, "older.minisig")), "не новее"),
        ("other_platform", INSTALLER, sign_artifact(inst, "a1", "0.9.1", platform_key="linux-x64", out=os.path.join(work, "plat.minisig")), "платформ"),
        ("other_product", INSTALLER, sign_artifact(inst, "a1", "0.9.1", product="lavray-linux", out=os.path.join(work, "prod.minisig")), "product"),
    ]
    for name, data, sg, word in cases:
        r = verify(stage(name + ".exe", data, sg))
        errs = " ".join(r[1].get("errors", [])) if r[0] == 200 else ""
        check(f"8.{name}.invalid", r[0] == 200 and not r[1].get("valid") and word in errs, (r[0], errs[:120]))
    big = os.path.join(work, "big.minisig")
    write(big, read(sig) + NL.encode() + b"A" * 5000)
    r = verify(stage("big.exe", INSTALLER, big))
    check("8.oversized_signature_file.invalid", r[0] == 200 and not r[1].get("valid") and "4096" in " ".join(r[1].get("errors", [])), r[1])
    r = verify(inst)
    check("8.path_outside_staging.invalid_argument", r[0] == 400 and r[1]["code"] == "invalid_argument", r[1])
    r = verify(os.path.join(c.staging(), "..", "..", "x.exe"))
    check("8.path_traversal.invalid_argument", r[0] == 400 and r[1]["code"] == "invalid_argument", r[1])
    r = verify("")
    check("8.empty_path.invalid_argument", r[0] == 400 and r[1]["code"] == "invalid_argument", r[1])
    r = verify(stage("viasig.exe", INSTALLER), minisigPath=os.path.join(work, "wa.minisig"))
    check("8.signature_outside_staging.invalid_argument", r[0] == 400 and r[1]["code"] == "invalid_argument", r[1])
    c.stop()


def cli(exe, *args):
    rc, out, err = run([exe, "verify-artifact", *args])
    return rc, out.strip(), err.strip()


def sec9_cli():
    """9. lavray-core verify-artifact: коды выхода 0, 1, 2 (так оболочка проверяет установщик перед UAC)."""
    inst, sig = X["local_inst"], X["local_sig"]
    work = os.path.dirname(inst)
    d = os.path.join(OUT, "s9data")
    shutil.rmtree(d, ignore_errors=True)
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", sig, "--data", d)
    j = json.loads(out) if rc == 0 and out else {}
    check("9.good.exit_0_with_version_and_sha256", rc == 0 and j.get("version") == "0.9.1" and j.get("sha256") == sha_hex(INSTALLER), (rc, out, err))
    bad = os.path.join(work, "tampered.exe")
    write(bad, INSTALLER[:5] + bytes([INSTALLER[5] ^ 1]) + INSTALLER[6:])
    rc, out, err = cli(X["exe"], "--file", bad, "--sig", sig, "--data", d)
    check("9.tampered.exit_1", rc == 1 and not out and "неверная подпись" in err, (rc, err))
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", os.path.join(work, "wa.minisig"), "--data", d)
    check("9.wrong_key.exit_1", rc == 1 and "keyid" in err, (rc, err))
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", os.path.join(work, "same.minisig"), "--data", d)
    check("9.not_newer.exit_1", rc == 1 and "не новее" in err, (rc, err))
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", os.path.join(work, "older.minisig"), "--data", d)
    check("9.older_without_allow_older.exit_1", rc == 1, (rc, err))
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", os.path.join(work, "older.minisig"), "--data", d, "--allow-older")
    check("9.older_with_allow_older.exit_0", rc == 0 and json.loads(out).get("version") == "0.8.0", (rc, out, err))
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", os.path.join(work, "plat.minisig"), "--data", d)
    check("9.other_platform.exit_1", rc == 1 and "платформ" in err, (rc, err))
    rc, out, err = cli(X["exe"])
    check("9.no_arguments.exit_2", rc == 2, (rc, err))
    rc, out, err = cli(X["exe"], "--file", os.path.join(work, "no-such.exe"), "--sig", sig, "--data", d)
    check("9.missing_file.exit_1", rc == 1, (rc, err))
    rc, out, err = cli(X["exe_ph"], "--file", inst, "--sig", sig, "--data", d)
    check("9.placeholder_root.exit_1_not_configured", rc == 1 and "not configured" in err, (rc, err))
    # корень, принятый ротацией, действует и для проверки установщика: подпись ключом a1 корня 2 проверяется по цепочке
    rd = os.path.join(d, "updates", "roots")
    os.makedirs(rd, exist_ok=True)
    shutil.copyfile(R("root2.json"), os.path.join(rd, "2.root.json"))
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", sig, "--data", d)
    check("9.accepted_rotation_chain_is_used", rc == 0, (rc, err))
    # подложенный в каталог данных «корень 2» с ключом установщика злоумышленника: подпись его ключом не проходит
    shutil.copyfile(R("root2-forged-artifact.json"), os.path.join(rd, "2.root.json"))
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", os.path.join(work, "wa.minisig"), "--data", d)
    check("9.planted_forged_root.attacker_signature_rejected", rc == 1 and "keyid" in err, (rc, out, err))
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", sig, "--data", d)
    check("9.planted_forged_root.genuine_signature_still_checked_by_embedded_root", rc == 0, (rc, err))


def sec10_agent():
    """10. Агентский токен: GetUpdateState читает, всё остальное закрыто в обоих режимах."""
    release()
    c = Core(X["exe"], "s10").start()
    for mode in ("read", "control"):
        c.rpc("SettingsService", "SetSettings", {"values": {"agent.mode": {"stringValue": mode}}})
        r = c.rpc("UpdateService", "GetUpdateState", {}, token=c.agent)
        check(f"10.agent.{mode}.GetUpdateState.allowed", r[0] == 200, (r[0], str(r[1])[:80]))
        for m_, body in (("CheckUpdates", {}), ("Rollback", {"component": "UPDATE_COMPONENT_APP"}), ("VerifyLocalUpdate", {"installerPath": "x"})):
            r = c.rpc("UpdateService", m_, body, token=c.agent)
            check(f"10.agent.{mode}.{m_}.denied", r[0] == 403 and r[1].get("code") == "permission_denied", (r[0], str(r[1])[:80]))
        for m_ in ("DownloadUpdates", "ApplyUpdates"):
            frames, end = c.stream("UpdateService", m_, {}, token=c.agent)
            check(f"10.agent.{mode}.{m_}.denied", not frames and (end.get("error", {}).get("code") == "permission_denied" or end.get("http") == 403), end)
    check("10.agent.checks_did_not_touch_the_network", last_checked(c) == 0, c.state())
    c.stop()


def sec11_channels():
    """11. Каналы: stable и beta ведут отдельные serial; загрузка идёт по настройке update.channel."""
    release(ver="0.9.2-beta.1", serial=50, tsv=3000, channel="beta")
    c = Core(X["exe"], "s11").start()
    r = c.check("UPDATE_CHANNEL_STABLE")
    check("11.stable_check_without_stable_manifest_finds_nothing", r[0] == 200 and not r[1].get("available"), (r[0], str(r[1])[:100]))
    r = c.check("UPDATE_CHANNEL_BETA")
    av = r[1].get("available", [{}])[0] if r[0] == 200 else {}
    check("11.beta_check_finds_beta", av.get("availableVersion") == "0.9.2-beta.1" and av.get("manifest", {}).get("channel") == "UPDATE_CHANNEL_BETA", (r[0], str(r[1])[:150]))
    check("11.beta_serial_is_separate", chain(c).get("maxSerial", {}).get("beta") == "50" and chain(c).get("maxSerial", {}).get("stable") == "0", chain(c))
    r = c.rpc("SettingsService", "SetSettings", {"values": {"update.channel": {"stringValue": "beta"}}})
    check("11.channel_setting_accepted", r[0] == 200 and r[1].get("acceptedKeys") == ["update.channel"], r[1])
    frames, end = c.download()
    check("11.download_follows_channel_setting", kinds(frames)[-1:] == ["verified"] and frames[-1]["verified"]["version"] == "0.9.2-beta.1", (kinds(frames), end))
    c.stop()


def main():
    started = time.time()
    env = dict(os.environ, CGO_ENABLED="0")
    rc, out, err = run(["go", "build", "-o", UPDSIGN, "./cmd/updsign"], cwd=CORE_SRC, env=env)
    if rc != 0:
        print("не собралась утилита updsign:", err[:300])
        return 1
    setup_keys_and_roots()
    X["exe"] = build("lavray-core-test.exe", R("root1.json"))
    X["exe_ph"] = build("lavray-core-placeholder.exe", None)
    check("0.setup.cores_built_and_keys_outside_repo", os.path.isfile(X["exe"]) and os.path.isfile(X["exe_ph"]), "")
    SITE_SRV.start(P1)
    SITE_SRV.start(P2)
    print(f"зеркала: {BOOT[0]} {BOOT[1]}; подготовка {time.time() - started:.0f} с", flush=True)
    try:
        for fn in (sec1_not_configured, sec2_success_path, sec3_metadata_negatives, sec4_state, sec5_rotation, sec6_transport,
                   sec7_artifact_negatives, sec8_local_verify, sec9_cli, sec10_agent, sec11_channels):
            try:
                fn()
            except Exception as e:  # noqa: BLE001 - сбой раздела не должен скрывать остальные
                import traceback
                traceback.print_exc()
                check(f"{fn.__name__}.no_exception", False, repr(e))
    finally:
        for port in list(SITE_SRV.servers):
            SITE_SRV.stop(port)
    failed = [r for r in RESULTS if not r["pass"] and not r["warn"]]
    warns = [r for r in RESULTS if r["warn"]]
    with open(os.path.join(OUT, "a13-result.json"), "w", encoding="utf-8") as f:
        json.dump({"total": len(RESULTS), "failed": len(failed), "warnings": len(warns), "checks": RESULTS}, f, ensure_ascii=False, indent=1)
    print(f"A13: проверок {len(RESULTS)}, провалов {len(failed)}, наблюдений WARN {len(warns)}, {time.time() - started:.0f} с")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
```
