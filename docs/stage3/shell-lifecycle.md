# shell-lifecycle.md — спецификация Rust/Tauri-оболочки LAVRay

> ЧЕРНОВИК Этапа 3 (stage3-drafts), ревизия 2 по L2-ревью 2026-10-23.
> Референс: `lavray/shell/README.md`; входные данные: `docs/AUDIT.md`,
> `docs/REQUIREMENTS.md` (281 FR), `docs/THREAT-MODEL.md`,
> `docs/UPDATE-SYSTEM.md` **v2.0**, `docs/PLATFORM-MATRIX.md`,
> `lavray/docs/BUGS.md` (LNB-06, LNB-09, LNB-18, LNB-20, LNB-21, LNB-25…27,
> LNB-33).
>
> Роль оболочки: нативный каркас (окно, трей, хоткеи, автозапуск, системный
> прокси, deep-link, права через помощника, автообновление) + нянька процесса
> `lavray-core`. Профили/подписки/сборка конфига/внешние ядра (за флагом) —
> ядро.

---

## 1. Дерево процессов и три времени жизни

```
lavray (Tauri shell, Rust)
 ├── lavray-core (Go)                     ← единственный ребёнок оболочки
 │    └── ext: naive / custom-external    ← только за флагом enable_external_cores
 │         (Pdeathsig/Job: сироты невозможны)   (решение владельца, см. допущения)
 └── rollback-помощник СТАРОЙ версии      ← живёт в установке; применяется при
      (и привилегированный помощник §7)     неудачном обновлении (UPDATE-SYSTEM §3)
```

Принцип из багов некора: **три ресурса живут разное время, и закрытие одного
не освобождает остальные** («закрытое соединение ≠ мёртвый процесс ≠
освобождённый TUN» — AUDIT §7.1.2, LNB-21):

| Ресурс | Время жизни | Кто освобождает |
|---|---|---|
| Connect-сессия UI↔core (UDS/pipe) | до Disconnect/обрыва | ядро (instance.Close) |
| Процесс lavray-core и его дети ext:* | spawn→exit | ядро (ext) + оболочка (core); Job/pgid — сирот нет |
| Ресурсы ОС: TUN-адаптер, маршруты, системный прокси (+ снимок PAC/WPAD — FR-UI-259), DNS-состояние | от подъёма до teardown | ядро (Close) + **страховка оболочки** (§6) + привилегированный помощник (§7) |

---

## 2. State machine жизненного цикла ядра

### 2.1 Диаграмма

```
                 spawn()                     ready-строка + /healthz 200
   ┌─────────┐ ─────────► ┌──────────┐  (§3, t_ready ≤ 2 s)   ┌─────────┐
   │  Idle   │            │ Spawning │ ──────────────────────► │  Ready  │
   └─────────┘ ◄───────── └──────────┘                          └─────────┘
        ▲            │            │ timeout t_spawn=10 s             │
        │            │            ▼            spawn failed          │ Connect() ok
        │            │       ┌──────────┐  (3 ретрая, потом)         ▼
        │            │       │ SpawnErr │──────────────────────► ┌───────────┐
        │            │       └──────────┘          rate-         │ Connected │
        │            │                               limited     └───────────┘
        │            │ exit (не по команде)              ▲            │
        │            └───────────►│    Crashed   ├──────┘            │
        │                          └──────────────┘ backoff-рестарт  │ Disconnect() ok
        │                          n<N за окно T: retry              │
        │                          n≥N за T: ─► RateLimited ─────────┘
        │   stop() graceful (§5): Disconnect → SIGTERM → wait → kill │
        └────────────────────────── Stopping ◄───────────────────────┘
                                          │
                                          ▼ verify teardown (§6)  ┌─────────┐
        Idle ◄──────────────────────────────────────────────────── │ Stopped │
                                                                    └─────────┘
```

### 2.2 Состояния

| Состояние | Инвариант | Выходы |
|---|---|---|
| `Idle` | процесса нет, сеть чиста (проверено) | spawn() → Spawning |
| `Spawning` | процесс запущен, ждём ready-строку + `/healthz` | ok → Ready; timeout 10 с / exit → SpawnErr |
| `SpawnErr` | процесс мёртв → прогон teardown-проверки §6 | ретрай ×3 с джиттером → RateLimited; успех → Idle |
| `Ready` | ConnectRPC жив (UDS/pipe), инстанс не активен | Connect → Connected (событие ядра, FSM FR-UI-261); exit → Crashed |
| `Connected` | инстанс активен (SystemProxy/TUN) | Disconnect/крах → Stopping / Crashed |
| `Crashed` | процесс мёртв не по команде; последние 200 строк stdout — в ring для диагностики (LNB-21/U-04) | backoff → Spawning (рестарт с тем же профилем, FR-UI-232); лимит → RateLimited |
| `RateLimited` | рестарты прекращены; состояние честное (индикатор «Ядро остановлено», профиль деактивирован) | ручной «Перезапустить» |
| `Stopping` | graceful-стоп §5, общий таймаут 15 с | teardown ok → Stopped |
| `Stopped` | мёртв по команде, сеть чиста | → Idle |

Тайминги: `t_ready` 2 с (бюджет, > 5 с — warning; TEST-PLAN §2: старт до
готовности ≤ 1500 мс); `t_spawn` 10 с; backoff 1/2/4/8/15 с (+джиттер 20 %);
rate-limit ≥3 падения за 60 с; `t_disconnect_rpc` 10 с (LNB-06);
`t_sigterm_wait` 5 с; `t_teardown_verify` 3 с.

---

## 3. Запуск: spawn, токен, ready-протокол

1. Оболочка **не выбирает порт и не занимает сокет** (fix TOCTOU MkPort,
   LNB-20; Р2-23): ядро стартует с `--listen-socket <path>` (UDS/named pipe,
   путь во временном каталоге 0700 со случайным именем) — порт выделяет ОС
   (`--port 0` в веб-режиме), **TCP-листенеров на десктопе нет вообще**
   (THREAT-MODEL §3).
2. Токен: 32 байта CSPRNG → base64url (fix mt19937, LNB-18); передаётся в
   **stdin** + `\n`; stdin держится открытым (закрытие = смерть родителя,
   страховка). Токен никогда в argv (ps), логах, событиях. Второй строкой stdin
   (сразу за основным токеном, необязательно) идёт агентский токен MCP — отдельный
   токен с правами белого списка `agent.mode`; его оболочка пишет в
   `agent-endpoint.json` только пока доступ агентов включён (`docs/MCP.md`).
3. Spawn `lavray-core serve` (cwd = каталог данных, права 0700):
   Windows: `CREATE_NO_WINDOW` + Job Object `KILL_ON_JOB_CLOSE`;
   Unix: `setsid` process group (kill по pgid, не по имени — LNB-09).
4. Ready-протокол: ядро печатает в stdout ОДНУ строку
   `LAVRAY_CORE_READY <transport-url>` (UDS-путь или `127.0.0.1:<port>` для
   веб-режима); оболочка дополнительно проверяет `/healthz` с Bearer (2×× —
   готово). Никакого парсинга «grpc server listening»/«failed to serve».
5. Отложенный старт профиля (выбран до готовности, incl. remember last —
   FR-UI-014) — очередь → первый Connect после Ready.

## 4. Пайп логов

- stdout/stderr → построчное чтение (отдельная задача tokio) → ring 200
  строк (посмертная диагностика Crashed); раннее окно (до готовности
  transport) — единственное назначение пайпа: рабочий журнал идёт через
  `LogService` ядра (redact в ядре, LNB-01/28).
- **Строки оболочки НЕ форвардятся в ядро** (Р2-43): UI склеивает два канала
  (LogService + Tauri-события) локально по timestamp.
- VT100/ANSI вырезается; антифлуд `max_log_line` строк/с; shell-лог
  `logs/shell.log` (ротация 5×1 МиБ) через тот же redact-фильтр.

## 5. Graceful shutdown (порядок обязательный)

```
выход приложения (FR-UI-022) / SIGTERM / commitDataRequest
  │
  ▼
1. CoreService.Disconnect(collect_stats=true)      [10 с]  ← instance.Close():
  │                                                        TUN down, маршруты, inbounds, статистика persist
  ├─ нет ответа → лог + шаг 2 с пометкой forced
  ▼
2. CoreService.Shutdown(REASON_EXIT)               [без ожидания]
  ▼
3. жив спустя 5 с → SIGTERM / TerminateProcess ПО ХЭНДЛУ/pgid (не по имени — LNB-09)
  │  жив ещё 3 с → SIGKILL / TerminateProcess(force)
  ▼
4. Дети ext:* (если флаг включён): Pdeathsig/Job убили их вместе с ядром;
   иначе — добить по сохранённым PID (никогда по имени образа)
  ▼
5. Снять системный прокси: ВОССТАНОВИТЬ СНИМОК (FR-UI-259) — прежние настройки,
   включая PAC/WPAD, сохранённые перед включением; не просто «DIRECT»
  ▼
6. Verify teardown (§6): адаптер/маршруты/прокси/DNS/процессы    [3 с]
  ▼
7. Окно/трей, single-instance лок, exit(0)
```

Аварийный выход оболочки (паника): ядру приходит смерть родителя (stdin
закрыт / Job закрыт / нянька) → ядро само graceful (Disconnect+Close) —
двойная страховка; оставшиеся хвосты ловит страж на следующем старте (§6).

## 6. Teardown-проверка сети («зависший TUN»)

После любого исхода, когда процесс ядра мёртв, и **на каждом старте**
(страж восстановления FR-UI-270):

| Проверка | Windows | Linux | macOS |
|---|---|---|---|
| Адаптер TUN | `Get-NetAdapter -Name lavray-tun` (Wintun) | `ip link show lavray-tun` | utun-адаптеры с нашей меткой |
| Маршруты | `route print` фильтр через адаптер | `ip route show dev lavray-tun` | `netstat -rn` |
| Системный прокси | WinINET == наш inbound? (иначе — снимок не восстановлен) | gsettings mode | networksetup |
| **DNS-состояние** (Р2-25) | WinINET-прокси затрагивает DNS-настройки IE; проверить `Get-DnsClientServerAddress` на эталон | `resolv.conf`/systemd-resolved == снимок эталона (FR-UI-259) | networksetup -getdnsservers == снимок |
| **Процессы ext:\*** (Р2-24) | Job закрыт → мертвы; иначе tasklist по PID | pgid мёртв; ps по PID | ps по PID |

Найденные **свои** хвосты → чистка (адаптер — удаление интерфейса/привиле-
гированный помощник §7; маршруты; прокси/DNS — восстановление снимка).
Диагностика «Troubleshooting» (настройки TUN) = ручной запуск чистки + лог.
Только свои ресурсы (имя `lavray-tun`, тег маршрутов, значение прокси =
наш inbound, сохранённый снимок DNS-эталона). Никаких «убить все процессы
с именем ядра» (LNB-09).

## 7. Права и привилегированный помощник (FR-UI-269, LNB-26/27)

Единая модель (UPDATE-SYSTEM §6, PLATFORM-MATRIX §1): **приложение никогда
не повышает права само** (никакого runas-рестарта себя — LNB-26); TUN
поднимает минимальный помощник, принимающий только **валидированный конфиг
по аутентифицированному IPC** (никаких путей/команд/файлов из каталога
пользователя в elevated-контексте — LNB-26/27).

| Платформа | Механизм | Детали |
|---|---|---|
| Windows | **Служба LAVRay** (per-machine, NSIS ставит) + IPC-помощник (named pipe с ACL: только Administrators+SYSTEM+текущий пользователь) | служба поднимает/опускает Wintun-адаптер и маршруты по командам ядра; UI и парсеры без прав; UAC — один раз при установке |
| Linux | **systemd-юнит** `lavray-tun.service`: `AmbientCapabilities=CAP_NET_ADMIN`, `NoNewPrivileges`, сокет-активация, доступ по группе `lavray` | **не** file-caps на бинаре (переносимый бинарь с CAP_NET_ADMIN — LNB-27), **не** `pkexec setcap` из PATH пользователя; AppImage — только с этим помощником |
| macOS | **SMAppService** (PrivilegedHelperDaemon, launchd) — ставится при первом включении TUN | общение по XPC: «поднять/опустить utun»; подписан тем же Developer ID |

Правила: помощник в защищённом каталоге; конфиг — по IPC + allowlist
(никаких скриптов/конфигов из `$HOME`); абсолютные пути к системным утилитам;
журнал действий помощника — локальный файл; аудит-тест LPE: подмена
`vpn-run-root.sh`-аналога из сессии пользователя → отвергнуто (TEST-PLAN
набор 6). Kill switch (FR-UI-275): при включении оболочка просит помощника
поставить блок-правило по умолчанию (off по default) — координация с W5
core-port-plan §3.1.5.

## 8. Single instance, каталог данных, deep-link, автообновление

### 8.1 Single instance (FR-UI-056) и каталог данных (FR-UI-247)

- Лок: named mutex `Global\LAVRay.SingleInstance` (Win) / abstract socket
  `\0lavray.single` (Linux) / flock (macOS). Вторая инстанция отправляет на
  лок «raise + argv» и выходит. `--many` — для разработки.
- **Каталог данных** (замена `-appdata` FR-UI-247): по умолчанию —
  платформенный app-data (`%LOCALAPPDATA%\LAVRay`, `~/.local/share/lavray`,
  `~/Library/Application Support/LAVRay`); `--appdata <dir>` переопределяет
  (документирован в документации пакетов, REQUIREMENTS §20.23). Права 0700
  на каталог, 0600 на файлы; рабочее ядро получает его через `--config`.
  Портативный режим (данные рядом с exe) — Windows-сборка с меткой
  `portable.marker` (для ZIP-дистрибутива).

### 8.2 Deep link (FR-UI-280, THREAT-MODEL)

- **ЕДИНСТВЕННАЯ схема v1: `lavray://import?url=<urlencoded>`** (Р1-10).
  Что было в ревизии 1 (`lavray://<действие>?`, `lavray://connect?`) — убрано:
  connect-by-link — отступление от THREAT-MODEL (любая страница может
  инициировать подключение); если владельцу нужен connect — отдельное
  решение с диалогом-подтверждением (записано в допущения).
- Обработка: строгий разбор (scheme=https/http, хост из allowlist — нет,
  url — произвольный контент для ИМПОРТА с preview), **всегда предпросмотр
  и подтверждение** (окно импорта с preview_only из контракта), rate-limit
  (≤5 ссылок/мин), длина ≤ 64 КиБ, никаких start/stop/update/settings в
  ссылке (автотест: `lavray://start` → отказ, TEST-PLAN набор 6).
- Регистрация: реестр `HKCU\Software\Classes\lavray`, `.desktop`
  MimeType, `CFBundleURLTypes`.

### 8.3 Автообновление — UPDATE-SYSTEM v2.0 (TUF-lite)

- **Клиент доверяет подписи, а не хосту**: allowlist источников — из
  подписанного `sources.json` (зеркала GitHub/Codeberg/свои домены);
  URL-пиннинга в коде НЕТ (Р0-1).
- Цепочка: `root.json` (порог 2-из-3 офлайн-ключей, ротация, отзыв) →
  `timestamp.json` (параллельно ≥2 источника, expires ≤ 7 дней; freeze-
  статусы: warning > 7 дней, красный > 30 — плюс «последняя успешная
  проверка N дней назад» вместо «нет обновлений») → `manifest.json`
  (product/channel/**монотонный serial**/expires/mandatory, assets+
  presets+geo с sha256+minisig; downgrade-артефакт отвергается по serial).
- Сеть: сначала через активный туннель, затем напрямую; DNS через DoH ядра;
  последний рабочий источник первым; периодичность ≤ 1/6 ч с джиттером.
- Применение: staging → sha256 → minisign → копия в защищённый каталог →
  повторная проверка (анти-TOCTOU) → атомарный перенос; прошлые файлы — в
  `updates/previous/`.
- **Откат выполняет СТАРОЙ версии rollback-помощник** (v2.0 §3 принцип 3):
  перед рестартом ставится heartbeat-флаг; если новая версия не отметилась
  здоровьем за 60 с — откат из `updates/previous/` силами старого помощника
  (или службы Windows). Tauri-updater остаётся только транспортом скачивания
  NSIS/appimage-артефактов; проверка подписей — наша (ed25519, публичные
  ключи — из root.json, не зашитый один ключ).
- Подпись релиза — **вне CI** (релиз-инженер или защищённый Environment с
  ревью, UPDATE-SYSTEM §4); CI собирает артефакты+чексуммы, манифест
  генерируется, подписывается отдельно (см. `../ci/*-windows/-linux/
  -macos.yml` — комментарии).
- `.deb` — не авто-применяется: инструкция `apt-get install --only-upgrade
  lavray` (v2.0 §6); macOS — только из «Программ».

## 9. Системный прокси, трей, хоткеи, автозапуск

- **Системный прокси (FR-UI-221–223 + FR-UI-259)**: WinINET / gsettings /
  KDE / networksetup. **Перед включением — снимок** текущих настроек
  (включая PAC/WPAD и DNS-эталон) → восстановление при выключении, выходе и
  после краха (teardown §6); проверка при старте (страж).
- Трей: состояния знака (fix-plan §4), меню Program (FR-UI-051) с поиском
  по серверам и «последние 5» (UX-7/DS v1.2 §7); свёртывание в трей
  (FR-UI-052/053); минимальный размер окна 880×560; геометрия — FR-UI-054.
- **Горячие клавиши (FR-UI-187/188)**: 4 слота (окно/группы/маршруты/
  системный прокси), выключены по умолчанию; X11 — глобальные, Wayland —
  портал GlobalShortcuts, macOS/Windows — нативно (PLATFORM-MATRIX §1);
  конфликты не регистрируются молча. Настройки — `hotkeys.*` (shell_owned).
- Автозапуск (FR-UI-224): HKCU Run (`--tray`), autostart .desktop,
  LoginItems (SMAppService); чекбокс отражает реальное состояние ОС.
- Онбординг (FR-UI-276): предвыбор пресета RU/CN/Глобальный по языку и
  часовому поясу ОС на первом запуске (список пресетов — пресеты ядра).

## 10. Каркас Rust-крейта, crash-handler, тесты

```
shell/
  src/
    main.rs               // single instance, deep-link, трей, окна, онбординг
    coreproc/mod.rs       // FSM §2
    coreproc/teardown.rs  // §6: TUN/маршруты/прокси+PAC/DNS/ext-процессы
    coreproc/logs.rs      // пайп §4
    privileges/{win_service.rs,linux_systemd.rs,macos_helper.rs} // §7 IPC
    proxy_os/{win.rs,linux.rs,macos.rs}   // §9 + снимок/восстановление FR-UI-259
    updater.rs            // §8.3: TUF-lite клиент + staging + heartbeat
    hotkeys.rs            // §9
    crash.rs              // FR-UI-229: минидампы (Win MiniDumpWriteDump,
                          // абсолютный путь к dbgeng-библиотекам — LNB-32),
                          // Linux/macOS — core pattern + локальный отчёт
    ipc.rs                // Connect-клиент (UDS/pipe; JSON-кодировка)
```

Тесты (job `rust` в `../ci/lavray.yml`): FSM-таблица §2.2 параметризованно;
backoff-расписание; teardown-детекторы (мок-вывод); ready-протокол; kill на
каждом состоянии; краш-цикл → RateLimited; kill только своего pgid;
deep-link инъекции → отказ; LPE-тест помощника (подмена конфига из сессии
пользователя → отвергнуто). VM-гейт релиза: UAC-модель (служба ставится,
UI не повышается), watchdog-откат обновления, страж после kill -9.
