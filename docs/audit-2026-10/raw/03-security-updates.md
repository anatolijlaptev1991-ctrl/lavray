# Сырой отчёт 03. Безопасность форка, BUGS.md и UPDATE-SYSTEM.md

> Проверка-субагент аудита 2026-10-23 (статический разбор; код не запускался, эксплойты не воспроизводились). Основной отчёт — `docs/AUDIT-CLAUDE-2026-10.md`; при расхождении приоритет у него и у `docs/fix-plan/`.

Обозначения путей: `nk/` = `D:\ZCode\nekobox\nekoray\`, `sb/` = `D:\ZCode\nekobox\sing-box\`. В `lavray/shell` и `lavray/ui` только README, кода на Rust/TS нет — поэтому §4 содержит требования к дизайну, а не баги кода. Внешние факты сверены по исходникам `codeclysm/extract` на GitHub, документации Tauri updater, новостям об OpenWrt 25.12 и документации jsDelivr.

**Главное (P0):**
1. **Подписка → RCE (N-01).** `nekoray://`-профиль несёт `c_cfg`. `MergeJson` не фильтрует ключи. `external_ui_download_url` в sing-box распаковывает zip без защиты от `..`. REQUIREMENTS FR-UI-256 требует сохранить эти точки расширения.
2. **UPDATE-SYSTEM.** Манифест не подписан. Ключ один, без отзыва и рабочей ротации. Репозитории, Pages, Actions и ключ — под одним аккаунтом.
3. **OpenWrt 25.12.0 (март 2026) заменил opkg на apk.** Весь §5 UPDATE-SYSTEM и `lavray-openwrt/feed` написаны про opkg.
4. **Планируемый HTTP-API.** Наружу идёт сырой `core_config`, адрес `0.0.0.0`, статичный токен, нет проверки Host/Origin.
5. **Блокировка GitHub даёт тихое «нет обновлений».** Пиннинг на github.com исключает зеркала.

## 1. Верификация BUGS.md

Итог: 18 CONFIRMED, 3 PARTIAL (04, 12, 24), 2 OVERSTATED (05, 14), 1 NOT CONFIRMED (15). §0 подтверждён: `gh api` → `has_issues:false` у `nekoray`. Репозитории `lavray*` сейчас private.

| LNB | Вердикт | Доказательство | Серьёзность / замечание |
|---|---|---|---|
| 01 | CONFIRMED, неполно | `sub/GroupUpdater.cpp:484,498-500,539,543` | «critical» завышено для форка (нужна передача лога) → P1. Остальные утечки — в N-04 |
| 02 | CONFIRMED | `go/grpc_server/update.go:86-113`; `go/cmd/updater/updater.go:36-65`. `codeclysm/extract` v2.2.0 (2019-04-05), `extractor.go`: `path = filepath.Join(location, path)` без проверки; `safeJoin` есть с v3.1.0. **AUDIT.md §5 «защищено от zip-slip» неверно** | P0 за отсутствие подписи. Сам zip-slip — P1. Ещё: архив целиком в памяти, симлинки с любой целью, `Mv` их разыменовывает (`updater.go:95-122`) |
| 03 | CONFIRMED | `updater.go:60-71` (`*.dll` удаляются до `Mv`); `main.go:57-62` (ошибки `Copy` глотаются) | P1 |
| 04 | PARTIAL | Шифрования и `setPermissions` нет; `main/NekoGui.cpp:184-199,231,283`; `db/Database.cpp:271` | «major» завышено: DPAPI не защищает от ПО того же пользователя. Выгода — 0600/ACL, multi-user Linux, бэкапы → P2 |
| 05 | OVERSTATED (код верен) | `main/HTTPRequestHelper.cpp:13-16,39,48`: схема и адрес не проверяются. URL вводит сам пользователь (`GroupUpdater.cpp:497-501,541`), SSRF слепой, кроме лога `:543`. Редирект на `file:` Qt, вероятно, отвергает [проверь] | P2 для форка. P1 в LAVRay, где URL придёт по API |
| 06 | CONFIRMED | `rpc/gRPC.cpp:172-183` (unlock из чужого потока); Start/Stop/Test/Update без таймаута (`:213-290`) | верно |
| 07 | CONFIRMED | `update.go:92-113`: нет таймаута и `StatusCode`; обрубок `../nekoray.zip` остаётся и подхватывается (`updater.go:26`) | P1 |
| 08 | CONFIRMED | `db/ConfigBuilder.cpp:655-657` | функциональный баг, не security |
| 09 | CONFIRMED | `ui/mainwindow.cpp:1826-1828`; `vpn_pid = 1; // TODO` на `:1790` (в BUGS «1784»); Linux: `pkexec killall -2 nekobox_core` `:1837` | P2: убивает чужие экземпляры, в т.ч. других пользователей |
| 10 | CONFIRMED | `ui/mainwindow_grpc.cpp:327-328,351-392,452,475`; `TrafficLooper.cpp:106-116` (в BUGS «76-90»); `GroupUpdater.cpp:644` | P2 |
| 11 | CONFIRMED | `update.go:17,51,65-89`. Сравнения «новее/старше» нет, предложит и более старый релиз | P1 |
| 12 | PARTIAL | `HTTPRequestHelper.cpp:72-73` без лимита, но таймер обрывает запрос на 10 с (`:57-61`): потолок = скорость × 10 с | P2 |
| 13 | CONFIRMED | `go/cmd/nekobox_core/happ/happdecrypt.go:234,254-259`: оба layout пробуются всегда, `body[14:22]` паникует при `len(body)` 13–21. `AUDIT.md §6` («без паник») неверно | minor в CLI. **P1 в LAVRay**: паника в горутине ядра убьёт туннель |
| 14 | OVERSTATED | `db/ConfigBuilder.cpp:796-800,812`: значения из собственных настроек пользователя — функциональный баг, не инъекция | P2 |
| 15 | NOT CONFIRMED | Мёртвое присвоение есть (`fmt/Link2Bean.cpp:265-266`), но `:257` (`url.port()==-1` → `return false`) отсекает ссылку без порта раньше. Проходит лишь порт 0 | trivial |
| 16 | CONFIRMED | `GroupUpdater.cpp:46`; в связке с N-05 стирает группу | P1 в связке |
| 17 | CONFIRMED | `fmt/Link2Bean.cpp:157` (порт 0), `:125-131` | P2 |
| 18 | CONFIRMED + поправки | (1) `main/NekoGui_Utils.cpp:74-75`: `mt19937(rd())` — сид 32 бита (в BUGS опечатка «mt19997»). (2) Хуже, чем в BUGS: sing-box по умолчанию даёт CORS `*`, WS без проверки Origin, токен WS в query (`sb/experimental/clashapi/server.go:101-103,196-205`): при включении Clash API его достаёт любая веб-страница. (3) `auth.go:24`. (4) `HappLink.cpp:30` | P2 для форка (API выключен по умолчанию). P1-требование для LAVRay |
| 19 | CONFIRMED | `HTTPRequestHelper.cpp:42-46,57-61`. «Без предупреждения» неточно: при SSL-ошибке пишется `(Ignored)` (`:54`) | P2 |
| 20 | CONFIRMED | `ui/mainwindow.cpp:385-386`; `NekoGui_Utils.cpp:146-152`. Захват порта = DoS. Токен не утекает | P2 |
| 21 | CONFIRMED | `sys/ExternalProcess.cpp:118-131` | P2 |
| 22 | CONFIRMED | `GroupUpdater.cpp:498-500` | P2 |
| 23 | CONFIRMED | Тесты только в `happ/`; в `nk/test/` — build-скрипты | верно (процесс) |
| 24 | PARTIAL | `happdecrypt.go:3-7` называет Apache-2.0 эталона и источник ключей, но LICENSE/NOTICE в дереве нет. `assets/*.json` — приватные RSA-ключи Happ | риск take-down репозитория |

## 2. Новые находки (нет в BUGS.md)

| P | Область | Проблема (file:line) | Почему важно | Исправление |
|---|---|---|---|---|
| P0 | N-01 Импорт → RCE | `nekoray://` загружает все поля профиля, включая `c_cfg`, `c_out`, `core=internal-full` (`GroupUpdater.cpp:61-69`, `fmt/AbstractBean.cpp:14-15`, `ConfigBuilder.cpp:82-89`). `MergeJson` не фильтрует ключи (`:32-70`). При `experimental.clash_api.external_ui(+_download_url)` sing-box качает zip и пишет файлы без защиты от `..` (`sb/experimental/clashapi/server_resources.go:97-125`; старт `server.go:154-155`; тег `with_clash_api` в `libs/build_go.sh`) | Подписку выдаёт полудоверенная сторона. Узел в подписке → «Тест задержки» группы (`ui/mainwindow_grpc.cpp:162`, `c_cfg` мержится и в тестовый конфиг) → запись в Startup/cron = RCE. Цепочка собрана по коду, не воспроизведена | Импортированным профилям игнорировать `c_cfg`, `c_out`, `core`, `cmd` (опт-ин с diff-подтверждением). Allowlist ключей merge (без `experimental`, `log.output`, чужих `inbounds`). Патч форка: запрет `..`, абсолютных путей и симлинков плюс лимит размера в `downloadZIP`. Тест с zip `../../x` |
| P1 | N-02 Повышение прав | root/админ исполняет файлы из каталога пользователя. Linux/macOS: `pkexec bash config/vpn-run-root.sh` и `osascript` (`mainwindow.cpp:1810-1813`; шаблон из оверрайда `config/vpn/vpn-run-root.sh`, `ConfigBuilder.cpp:827-848`). Windows: `runProcessElevated(app\nekobox_core.exe run -c config\sing-box-vpn.json)` (`mainwindow.cpp:1790-1793`, `ConfigBuilder.cpp:803-819`). Для TUN GUI целиком перезапускается от админа (`:697-703`) | Любое ПО того же пользователя подменяет файл и получает root/Admin на законном запросе пароля или UAC | Минимальный root-owned помощник (служба Windows, systemd unit, SMAppService) в защищённом каталоге. Конфиг — по аутентифицированному IPC + allowlist. GUI не повышать |
| P1 | N-03 Linux caps | `pkexec <setcap из PATH пользователя>` (`sys/linux/LinuxCap.cpp:21,37-50`) — подмена `~/.local/bin/setcap`. `setcap cap_net_admin=ep` на переносимый `nekobox_core` (`mainwindow.cpp:751`) даёт CAP_NET_ADMIN любому, кто может его запустить | LPE и захват сети на многопользовательской машине | Абсолютные пути. systemd unit с `AmbientCapabilities=CAP_NET_ADMIN`, доступ через сокет и группу |
| P1 | N-04 Логи и секреты | `go/cmd/nekobox_core/grpc_box.go:41-43`: при `-debug` печатается весь `core_config`. `sys/ExternalProcess.cpp:13,52`: в лог идут env процесса и argv внешнего ядра (naive: `--proxy=https://user:pass@…`). `mainwindow.cpp:1340`: результат QR. `core_box.go:21`: `config/neko.log` на диске [права и ротация — проверь]. Go `*url.Error` и Rust `reqwest::Error` печатают URL с токеном | Логи уходят в баг-репорты, а в LAVRay ещё и в веб-панель | Единый `redact()` на входе логов (query, userinfo, ссылки, JSON-поля). Запрет логировать env, argv, config. `without_url()`. Тест «секрета нет ни в одной строке» |
| P1 | N-05 Подписки | Деструктивное обновление. Ответ 200 с мусором или пустой (captive-portal, DPI-заглушка, challenge, ложный `proxies:`) → `group->order.clear()` (`GroupUpdater.cpp:566`) → cleanup удаляет все профили группы (`:620-624`). При `sub_clear` — ещё до разбора (`:569-573`). `:610` `deleted_index > 0` (возможно, должно быть `>= 0`) [проверь] | Массовая потеря серверов именно там, где отдают заглушки (РФ/КНР) | Разбор в staging. Пустой или подозрительный результат не применять (> 50 % удалений — подтверждение). Снапшот и «откат подписки» |
| P1 | N-06 Supply chain / CI | `libs/download_qtsdk_win.sh:4-6` качает готовый Qt без хеша. Workflow качает `ghr` и запускает с `github.token` (`build-nekoray-cmake.yml:164,215`), actions по тегам, `ACTIONS_ALLOW_UNSECURE_COMMANDS` (`:72`), `chitang233/aur-pkgbuild-builder@main` + `secrets.DEPLOY_KEY` (`update-pkgbuild.yml:15-17`). `COMMIT_NET="9f3d514b"` — короткий SHA (`libs/get_source_env.sh:3`). libneko и x/net через `replace ../../../../` вне дерева. `grpc_server/go.mod`: grpc 1.49 | Закладка в стороннем артефакте попадает в релиз. Релизы форка `immutable:false`, без подписей (`gh api`) | Пины по SHA/digest, проверка хешей всех загрузок, минимальные `permissions`, vendoring, SBOM, immutable releases |
| P2 | N-07 Правила и гео | Remote rule-set с изменяемой ветки стороннего репозитория, `download_detour: direct`, без хеша (`ConfigBuilder.cpp:474-475`). CI тянет geoip/geosite `latest` (`libs/build_public_res.sh:9-12`) | Подмена правил — тихий обход туннеля. При блокировке `raw.githubusercontent.com` старт без кеша может падать [проверь] | Вендорить `.srs` в подписанный `geo.json`, detour через прокси |
| P2 | N-08 Файлы и ядро | Секреты внешних ядер в `config/temp/*.json` (`fmt/Bean2External.cpp:145,213,254`), чистка только при старте (`main/main.cpp:114`). `JsonStore::Save` не атомарен, ошибки не проверяются (`NekoGui.cpp:194`). `LoadLibrary("DBGHELP.DLL")` по имени (`sys/windows/MiniDump.cpp:28`). `Test` без проверки `in.Config != nil` → nil-deref роняет ядро, recover-интерсептора нет (`grpc_box.go:126`, `grpc.go:91-94`) | Утечки при крахе, порча конфигов, DoS ядра | 0600/ACL. tmp в runtime-каталоге с удалением сразу. Atomic rename + fsync. Путь к System32. recover + валидация |
| P2 | N-09 Сеть и приватность | «Allow LAN» = listen `::` без обязательной авторизации (`mainwindow.cpp:319-322`, `ConfigBuilder.cpp:395-407`). VPN-шаблон пускает мимо туннеля любой процесс с именем `nekobox_core` (`res/vpn/sing-box-vpn.json`). `sub_use_proxy=false` по умолчанию (`NekoGui_DataStore.hpp:121`) | Открытый прокси в LAN. Обход VPN. Токен подписки и IP уходят напрямую (и блокируются в РФ/КНР) | Авторизация обязательна при LAN. Правило по пути, не по имени. «Через туннель, если поднят» |
| P2 | N-10 Update-UI | `release_url` из JSON → `QDesktopServices::openUrl` без проверки схемы (`mainwindow_grpc.cpp:550`, `update.go:78`). Заметки в `QMessageBox` как AutoText (`:518`). `browser_download_url` без allowlist (`update.go:75,92`) | `file:` и кастомные схемы по клику, HTML-спуфинг | Только https + allowlist, plain text |

## 3. UPDATE-SYSTEM.md

### 3.1 Закрывает ли LNB-02/03/07/11?

| LNB | Закрыт? | Остаточная дыра |
|---|---|---|
| 02 | Частично | §3–4 дают подпись и sha256. Но манифест (`version`, `sha256`, `size`, `channel`, `mandatory`, `notes`) не подписан: у Tauri updater подписан только артефакт (docs v2.tauri.app/plugin/updater). В §7 нет тестов zip-slip, симлинков и `..`. apt (GPG) и OpenWrt (usign/apk) — отдельные корни доверия, не описаны |
| 03 | Частично | Откат «до входа в UI» исполняет новая версия: если она не стартует, откат не сработает. В docs Tauri нет бэкапа или отката, на Windows приложение завершается при установке. Нет бэкапа и миграции данных, нет сценария залоченных файлов sidecar |
| 07 | Частично | Нет таймаутов и idle-таймаута, проверки HTTP-статуса и `Content-Length == size`, лимита размера, очистки обрубков, правил Range-докачки. Нет защиты от TOCTOU (проверили в `%TEMP%`, запускаем оттуда же) |
| 11 | В основном | Semver есть. Не определены суффиксы форка (`4.0.1-happ.4-sb114`; по semver `1.14.1-neko.1` < `1.14.1`), запрет понижения и привязка `channel` к подписи |

### 3.2 Модель угроз в стиле TUF

| P | Угроза | Дыра в документе | Исправление |
|---|---|---|---|
| P0 | Replay, freeze, mix-and-match, channel confusion | Подписан только артефакт. `version`, `channel`, `mandatory`, `notes`, `minUpgradeFrom` не защищены (§3). Возможны: вечный старый манифест, `mandatory:true` для DoS, beta вместо stable (beta `1.3.0-rc` > stable `1.2.5` по semver) | TUF-lite: `root.json` (офлайн, threshold 2-из-3, expires), `timestamp.json` (онлайн, ≤ 7 дней), `manifest.json` с `serial`. minisign trusted comment: `product;platform;channel;version;serial`. Клиент хранит max serial и отвергает меньший serial и чужой channel |
| P0 | Ключи | Один ключ в приложении. «Меняется только с major, двойное подписание» (§3) не работает при компрометации: атакующий выпустит апдейт со своим новым ключом, подписанным старым. Отзыва нет. Ключ обычно в Actions secrets (`TAURI_SIGNING_PRIVATE_KEY`) | Офлайн-root (YubiKey, FIDO2 sshsig или KMS). Онлайн-ключ релиза с `expires` и списком отозванных. Процедура аварийной ротации в `SECURITY.md`. У Tauri один `pubkey`, набор ключей проверять своим кодом (`minisign-verify`) [проверь] |
| P0 | Аккаунт и CI | Репозитории, Pages, Actions и ключ — под одним аккаунтом. Релизы форка `immutable:false`, без подписей | Аппаратная 2FA, protected tags, Environment с ревью, OIDC, `permissions: read` по умолчанию, SHA-пины, immutable releases, provenance-аттестация, воспроизводимая сборка (`-trimpath`, `SOURCE_DATE_EPOCH`), подпись релиза вне CI |
| P1 | URL-пиннинг | «Только github.com/githubusercontent.com» (§3) не пиннит репозиторий (любой чужой проходит) и запрещает зеркала | Доверять подписи, не хосту. Allowlist берётся из подписанного `sources.json`, только https, проверка на каждом редиректе |
| P1 | Presets / geo | «Мини-манифесты» (§2, §4) без подписи, а они меняют маршрутизацию | Тот же манифест + serial + подпись |
| P1 | Fail-open | «Нет сети → нет обновлений» (§7) неотличимо от блокировки или freeze | Состояние «проверка не удалась N дней» (7 дней — предупреждение, 30 — красный) |
| P2 | Ядро только в связке | Запрет отдельной доставки ядра (§4, §6) тормозит реакцию на CVE и блокировки протоколов | Разрешить hot-patch ядра по тому же манифесту с полем `minApp` |

### 3.3 Платформы

| P | Платформа | Дыра | Исправление |
|---|---|---|---|
| P0 | OpenWrt: формат | В 25.12 вместо opkg apk (`.apk`, `packages.adb`, подписи обязательны). §5 и `feed/README.md` целиком про opkg/ipk/`Packages.sig`. `/etc/opkglavray.conf` — не читаемый opkg путь [проверь]. Имена пакетов расходятся (`lavrayd`, `lavray-webui` vs `lavray-core`, `lavray-web`), как и раскладка (`feed/<arch>` vs `feed/stable\|beta`) | Два фида: ipk + usign для ≤ 24.10 и apk для ≥ 25.12, под каждую серию и arch. Скрипт обновления определяет `apk`/`opkg`. Единая раскладка — в UPDATE-SYSTEM §5 |
| P1 | OpenWrt: доверие и откат | Ключ фида нужно положить в `/etc/opkg/keys/<id>` до `opkg update` (шага в README нет — пользователи отключат проверку). Откат `opkg install <старая>` требует сети, которую сломал апдейт. `opkg upgrade` из rpcd от root | Fingerprint ключа публиковать вне GitHub. Прошлый пакет хранить локально + procd-watchdog «нет связи N минут → откат». Обновлять только именованные пакеты (docs OpenWrt не советуют `apk upgrade` целиком), ACL rpcd |
| P2 | OpenWrt: ресурсы | `.ipk` качается в `/tmp` (RAM), в overlay нужно ≥ 2× размера. Частые записи статуса и geo изнашивают flash | Статус и логи в tmpfs. geo — не чаще раза в неделю. Отказ при свободном месте < 2× пакета |
| P1 | Windows / NSIS | sidecar `lavray-core.exe` держит файлы. Tauri завершает приложение при установке и прошлую версию не хранит. Per-machine установка требует UAC при каждом апдейте, per-user доступна вредоносу — а повышенный TUN-процесс нельзя запускать из пользовательского каталога (N-02). Authenticode из РФ/КНР труднодоступен [проверь] | Per-machine + служба для TUN. NSIS-хуки: остановить sidecar, снять TUN и системный прокси [проверь]. Rollback-помощник от старой версии. Инсталлятор копировать в защищённый каталог → повторная проверка → запуск |
| P1 | macOS | App Translocation: из DMG/Downloads самообновление невозможно [проверь]. Notarization требует Developer ID (в плане «либо неподписанные»; регистрация из РФ [проверь]). sidecar подписывается отдельно [проверь]. Повышение через `osascript` | Требовать «Move to Applications» до включения апдейтера. Привилегированный помощник (SMAppService) |
| P1 | Linux | Tauri updater умеет только AppImage (docs). TUN в AppImage невозможен. «.deb через pkexec apt upgrade» обновит всю систему. Нужны keyring (`signed-by`) и `Valid-Until`. Пул .deb в Pages упрётся в ~1 ГБ | `apt-get install --only-upgrade lavray`. Пул на Releases/CDN, индекс на Pages. systemd unit вместо setcap |

### 3.4 Зеркала и обход блокировок

**Проблема.** GitHub, Pages и jsDelivr в РФ/КНР нестабильны [проверь актуальные замеры]. jsDelivr не поддерживает файлы GitHub > 20 МБ. По замеру GreatFire от 2026-03-17 `cdn.jsdelivr.net` блокируется в материковом Китае [актуальность не подтверждена], поэтому он годится только для метаданных и не для КНР. Tauri переходит к следующему endpoint лишь при не-2XX ответе; таймаут, RST и DNS-подмена этим не покрыты [проверь].

**Принцип.** Доверие даёт подпись, транспорт взаимозаменяем.
1. **Подписанный `sources.json`** — упорядоченный список источников: GitHub Releases и Pages; зеркало на GitLab или Codeberg; два своих домена на разных провайдерах и регистраторах (R2/B2 плюс хостинг в РФ; для КНР — регион HK без ICP); jsDelivr — только метаданные; IPFS CID или magnet внутри подписанного манифеста.
2. **Выбор источника.** `timestamp.json` минимум из двух источников параллельно (connect 3 с, первый байт 5 с), берётся наивысший валидный `serial`. Артефакт — с любого источника с failover и докачкой по ETag. Всегда проверять размер, sha256 и подпись. Запоминать последний рабочий источник.
3. **Путь.** Сначала через активный локальный inbound, если туннель поднят; затем напрямую. DNS — через DoH или резолвер ядра. Для параллельных запросов и выбора зеркала нужен собственный fetcher; plugin Tauri — только для установки [проверь].
4. **Офлайн-путь.** «Установить из файла»: инсталлятор + `.minisig` + manifest. Ссылки на зеркала — на сайте и в Telegram. Отпечатки ключей — в README, на сайте и в подписанных тегах.
5. **UX и сеть.** Backoff с jitter. «Последняя успешная проверка N дней назад». Не писать «нет обновлений», пока не было ни одной успешной проверки.
6. **OpenWrt.** Обёртка `lavray-update` выбирает рабочее зеркало и переписывает единственный активный URL фида. opkg не делает failover между URL одного фида; для apk [проверь].

## 4. Новые архитектурные риски

| P | Область | Проблема | Почему важно | Исправление |
|---|---|---|---|---|
| P0 | API-поверхность | Наружу планируются `Start(core_config)`, `Test(address, url)`, `Update` (AUDIT §9.1, proto/README) | Сырой sing-box JSON = запись файлов (`log.output`, N-01). На OpenWrt ядро, вероятно, root → RCE при любом обходе авторизации. `Test` — сканер портов и SSRF | API принимает структуры (профиль, маршрут), конфиг строит только ядро; `c_cfg` по умолчанию запрещён. URL подписок: валидатор схем и IP после резолва (rebinding), контроль редиректов, лимиты. `Update` не принимает URL |
| P0 | CSRF, CSWSH, DNS-rebinding на 127.0.0.1 | Любая страница шлёт запросы на `127.0.0.1:порт`, порт перебирается из JS. WebSocket не защищён SOP | Кража данных и управление туннелем | Десктоп: unix-socket (0600, каталог 0700) или named pipe с ACL — TCP не нужен. Если TCP: проверка `Host`, `Origin` (для WS), `Content-Type: application/json` + кастомный заголовок, CORS без `*`, токен на всех путях. Порт 0, токен и порт — через stdin или inherited fd (не MkPort, LNB-20). Не копировать clashapi (N-01, LNB-18) |
| P0 | OpenWrt-панель | AUDIT §9.1: `0.0.0.0` + статичный токен, TLS «опционально». Сравнение токена не constant-time | `0.0.0.0` включает WAN, гостевые зоны и VPN. Токен по HTTP виден в LAN. Защиты от перебора нет | Bind на LAN-адрес из UCI, не `0.0.0.0`. Логин + пароль (Argon2id) → сессия `HttpOnly; SameSite=Strict; Secure` + CSRF-токен, лимит попыток с backoff. HTTPS (self-signed + fingerprint в LuCI) или за uhttpd/LuCI. CSP, `frame-ancestors 'none'`, `nosniff`. Токен не в URL и не в `localStorage` |
| P1 | Tauri 2 | Не решено, ходит ли webview напрямую по HTTP (`ui/README`: клиент из proto) или через IPC (`shell/README`: «шлюз IPC») | При прямом доступе токен виден JS: XSS = полный контроль | Токен только в Rust, UI ↔ Rust-команды. Capabilities минимальны для каждого окна (updater, shell, fs, clipboard — только main). Без `shell:execute` с произвольными args. `fs` только app-data или не использовать. `opener` — https-allowlist. Не открывать удалённый URL в окне с IPC (`remote.urls`). CSP `default-src 'self'; object-src 'none'; connect-src ipc: http://ipc.localhost`. Isolation pattern. Release без devtools, `freezePrototype` |
| P1 | Deep-link `lavray://` | Вызывается любой страницей или приложением; аргумент приходит в командной строке (single-instance) | Импорт чужой подписки одним кликом, prompt-bomb, инъекция аргументов | Только `lavray://import?url=`. Строгий разбор (запрет пробелов, кавычек, управляющих символов), флаги не принимать. Всегда диалог с превью и хостом, нужен жест пользователя, rate-limit. Никаких start/stop/update/settings. Не подключать автоматически |
| P1 | Импорт из буфера | Авто-чтение буфера видит чужие данные; вредоносная страница пишет в него ссылку | Подмена подписки, утечка пароля из менеджера | Читать по действию пользователя или при фокусе и строгом префиксе. «Импортировать?» — никогда молча. Очищать буфер или помечать (Windows `ExcludeClipboardContentFromMonitorProcessing`) |
| P1 | Недоверенные строки | Имена профилей, заметки и логи управляют UI (XSS → IPC, BiDi-спуфинг, ANSI). `design/prototype.html` — около 30 `innerHTML` (с `esc()`) | В React легко повторить паттерн | Запрет `dangerouslySetInnerHTML`. Sanitizer для markdown без картинок и `javascript:`. Нормализация управляющих и BiDi-символов |
| P2 | Секреты | Файл или keychain | DPAPI/Keychain/libsecret защищают от кражи диска и бэкапа, не от ПО того же пользователя. На OpenWrt и headless keychain нет | Envelope-шифрование (ключ в DPAPI/Keychain/libsecret, fallback — файл 0600 root). Секреты не в argv/env. Экспорт с паролем. Не хранить в синхронизируемых каталогах |
| P2 | Крэш-дампы и паники | Panic с `Debug` ошибок печатает URL с токеном. Windows `MiniDumpNormal` содержит стеки (`MiniDump.cpp`). WebView2 crash reports [проверь] | Токены в отчётах | `panic=abort` + свой hook без полей. `GOTRACEBACK=single`, `RLIMIT_CORE=0`, `PR_SET_DUMPABLE=0`. Redact до записи. Дампы — в защищённый каталог и только с согласия |

## 5. Что не проверено

Код не запускался; цепочка N-01 собрана чтением (`MergeJson`, путь `Test` в `mainwindow_grpc.cpp:162`, сборка с `with_clash_api` в `libs/build_go.sh`). Локально нет libneko (права и ротация `neko.log`), форка x/net (`9f3d514b`), русского README форка. Репозитории `lavray*` private — публичную раздачу, Pages и feed проверить нельзя. Rust/TS-кода нет — §4 содержит требования. Пометки [проверь]: поведение Qt при редиректе на `file:`; доступность GitHub, Pages и jsDelivr из РФ/КНР сегодня; Developer ID и Authenticode из РФ; failover Tauri при таймаутах; несколько ключей в Tauri updater; NSIS-хуки для sidecar; failover между apk-репозиториями; путь `/etc/apk/keys`.

Источники: [Tauri updater](https://v2.tauri.app/plugin/updater/), [OpenWrt 25.12.0](https://www.helpnetsecurity.com/2026/03/09/openwrt-25-12-0-released/), [opkg→apk cheatsheet](https://openwrt.org/docs/guide-user/additional-software/opkg-to-apk-cheatsheet), [jsDelivr](https://github.com/jsdelivr/jsdelivr), [GreatFire: jsDelivr из КНР](https://en.greatfire.org/https/cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js), [codeclysm/extract](https://github.com/codeclysm/extract) (теги v2.2.0, v3.1.0).
