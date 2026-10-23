# stage3-drafts/ — черновики Этапа 3 (реализация LAVRay)

> Ревизия 2 — после adversarial-ревью L2 (`docs/REVIEW-STAGE3-DRAFTS.md`,
> 2026-10-23): закрыты 2 P0, 17 P1, P2 (№20–45) и пункты «Пропущено
> полностью». Назначение папки прежнее: рабочие драфты для ревью владельцем;
> ничего не попадает в `lavray*/`, `docs/`, `design/`, `nekoray/`, `sing-box/`
> до утверждения.

## Состав (ревизия 2)

| Файл | Что внутри | Куда переедет |
|---|---|---|
| [`proto/lavray.proto`](proto/lavray.proto) | Контракт v1 (рев.2): **13 сервисов, 85 методов, 10 стримов**, 182 сообщения, 36 enum; FR-комментарии к каждому методу; TUF-lite UpdateService; Diagnostics- и Gateway-сервисы; import-hardenening LNB-25 | `lavray/proto/lavray.proto` |
| [`proto/README.md`](proto/README.md) | Маппинг на 7 методов, стримы, версионирование (reserved-журнал), транспорт UDS/pipe, cookies+CSRF | `lavray/proto/README.md` |
| [`core-port-plan.md`](core-port-plan.md) | Порт C++→Go: MergeJson-allowlist, 35 golden-векторов (+`sing-box check`, deviations.yaml), парсеры+fuzzing, SQLite (sort_key каноничен, 0700/0600, routes_box, таблица 56 ключей), clash-api hardening, шлюз nft.go/watchdog, TUF-lite клиент; 8 недель с гейтами | `lavray/core/PORT-PLAN.md` |
| [`shell-lifecycle.md`](shell-lifecycle.md) | Оболочка: FSM ядра, UDS/pipe + `-port 0`, teardown (TUN/маршруты/прокси+PAC/DNS/ext), права (служба Windows / systemd AmbientCapabilities / SMAppService), deep-link только import, TUF-lite updater + rollback-помощник, хоткеи, crash-handler | `lavray/shell/LIFECYCLE.md` |
| [`ci/lavray.yml`](ci/lavray.yml) | Качество: go/rust/node/proto/presets + summarize; permissions: read | репо `lavray` |
| [`ci/lavray-windows.yml`](ci/lavray-windows.yml) | Windows: NSIS+ZIP, ed25519, черновик manifest-<channel>.json (подпись вне CI), attach-release с узкими правами | репо `lavray-windows` |
| [`ci/lavray-linux.yml`](ci/lavray-linux.yml) | Linux: контейнеры 22.04/24.04 (digest-пины), deb+AppImage (linuxdeploy с sha256), apt-гейт v2.0 | репо `lavray-linux` |
| [`ci/lavray-macos.yml`](ci/lavray-macos.yml) | macOS: universal, dmg+updater-артефакты в релизе, notarization за `vars.HAVE_SIGNING` | репо `lavray-macos` |
| [`ci/lavray-openwrt.yml`](ci/lavray-openwrt.yml) | OpenWrt: матрица {24.10 ipk+usign; 25.12 apk}, 2 арх, feeds, индекс в feed/<arch>, Pages | репо `lavray-openwrt` |
| [`presets/lav-ru.json`](presets/lav-ru.json) | LAV Preset RU — конвертация `lav-ru.source.json` (+ads §3b) | `lavray/presets/lav-ru.json` |
| [`presets/lav-cn.json`](presets/lav-cn.json) | LAV Preset CN rev 2: CN-гео direct, `geolocation-!cn` proxy, ads-block, AI/игры процессные | `lavray/presets/lav-cn.json` |
| [`presets/global.json`](presets/global.json) | Глобальный: ads-block, LAN direct, остальное прокси | `lavray/presets/global.json` |
| [`presets/all-proxy.json`](presets/all-proxy.json) | Всё через прокси | `lavray/presets/all-proxy.json` |
| [`presets/all-direct.json`](presets/all-direct.json) | Всё напрямую | `lavray/presets/all-direct.json` |
| [`presets/SCHEMA.md`](presets/SCHEMA.md) | Схема v1 (правка 2): sniffing 0|1, DROP-поля, §3b/§3c, routes_box, 5 builtin, конвертер, онбординг | `lavray/presets/SCHEMA.md` |

## Ключевые архитектурные решения (сводка; вердикты ревью — в скобках)

1. **Конфигбилдер в ядро, Connect(profile_id, mode)** — ПРИНЯТО ревью
   (условия выполнены: P0-2, cache_file/geo, deviations.yaml).
2. **Стримы вместо эвристик** (10) — ПРИНЯТО С ПРАВКОЙ (выполнены: WS-auth,
   фильтры/backpressure, оговорки хвостов, клейка логов оболочки на UI).
3. **SQLite WAL + modernc + миграция** — ПРИНЯТО С ПРАВКОЙ (выполнены:
   0700/0600, sort_key каноничен/profile_order вычисляем, routes_box).
4. **Три времени жизни + teardown-верификация** — ПРИНЯТО С ПРАВКОЙ
   (выполнены: DNS в таблице teardown, сироты ext (Pdeathsig/Job), права
   переведены на модель помощника — решение 1 слилось с №3).
5. **Внешние ядра** — ОСПОРЕНО ревью; реализована рекомендация: **v1 = naive +
   custom-external за явным флагом `enable_external_cores` (off по
   умолчанию, пометка «решение владельца ожидается»); hy2/tuic всегда
   внутренние** (force_external_core удалён из контракта). При включении
   флага: изоляция, секреты 0600/env, Pdeathsig/Job, лог без env/argv.
6. **Пресеты versioned/platform-scoped** — ПРИНЯТО С ПРАВКОЙ (выполнены:
   ads-правило во всех builtin, полный набор 5 шт., приоритеты golden,
   routes_box, §3b/§3c-ссылки).

## Допущения и решения владельца (полный список)

**Требуют решения владельца до/при реализации:**
1. **Внешние ядра** (см. решение 5): подтвердить флаг-off-by-default для
   naive/custom-external или полный DROP (тогда extcore-модуль удаляется).
2. **XHTTP (FR-UI-281)**: форк ядра с XHTTP / Xray как доп-ядро только для
   XHTTP / отказ с понятным сообщением. В v1 — отказ с сообщением.
3. **DROP-поля некора**: `domain_strategy`, `direct_dns_strategy`,
   `dns_final_out`, третий режим сниффинга — убраны из контракта/схемы;
   пере-включение (если билдер будет их реально применять) — решение
   владельца при портировании W4–W5.
4. **Deep-link `lavray://connect`** — убран из v1 (THREAT-MODEL). Если
   нужен — отдельное решение с обязательным диалогом-подтверждением.
5. **Правило рекламы в lav-cn** (ревью №13) — включено по PRESET-LAV-RU §3b
   («во всех встроенных пресетах»); если владелец не хотел ads в CN —
   убрать одну строку block_domain (rev 3).
6. **Хоткеи (FR-UI-187/188, NICE)** — оболочка §9 (X11/портал Wayland);
   слоты 4, off по умолчанию. Реализация — после v1 UI-каркаса.
7. **Онбординг-предвыбор (FR-UI-276)**: язык → RU/CN/Глобальный; уточнение
   по часовому поясу — правила на ревью UI (SCHEMA §7).

**Принятые допущения (задание/эталоны молчали):**
8. Гео-категория рекламы — `geosite:category-ads-all` (не устаревший
   `geosite:category-ads`).
9. WS-мост `/api/v1/ws` — для браузеров без duplex-fetch (Safari).
10. `profiles.data` — канонический JSON контракта (не колонки).
11. Хвосты Stats/Connections/подписок не сохраняются: восстановление через
    GetStatus/GetTrafficTotals/переподписку; персистентный event-log — задел.
12. **Kill switch (FR-UI-275, SHOULD)** — v1.x, W5: флаг `tun.kill_switch`
    (off по умолчанию), координация с помощником (shell §7).
13. **HWID (FR-UI-265, SHOULD)** — W3, opt-in `sub.hwid_enabled`, случайный
    per-install ID; регистрация UA в панелях — вне кода.
14. **Доп-протоколы (FR-UI-267, SHOULD)** — отложены после v1; в контракте
    зарезервированы NETWORK_QUIC и reality_spx.
15. `-appdata`/каталог данных (FR-UI-247) — `--appdata <dir>` +
    платформенные app-data по умолчанию; портативный режим Windows-ZIP
    (shell §8.1).
16. **Crash-handler (FR-UI-229, NICE)** — shell §10: минидампы Windows
    (абсолютные пути к системным библиотекам отладки — LNB-32), core/отчёт
    на POSIX; реализация с каркасом оболочки.
17. OpenWrt 25.12 apk-упаковка — placeholder в CI (матрица готова,
    реализация с первым SDK 25.12).
18. Инструменты CI — будущие скрипты (вызовы закомментированы в yml):
    `tools/gen-manifest.mjs`, `core/libs/core-version.sh` (POSIX) и
    `core/libs/core-version.ps1` (Windows-вариант — тот же пин форка),
    `core/libs/get_source.sh`, `openwrt/pack-ipk.sh`,
    `core/libs/pins/linuxdeploy.sha256`.
19. **Actions-по-SHA и digest-пины контейнеров (LNB-30, №37)** — осознанно
    отложены с драфта на прод-гейт: до переноса workflow в реальные репо все
    `actions/*@tag` пинятся по commit-SHA, а `container:`/образы — по
    digest. ТРЕКИНГ: включить в чек-лист приёмки каждого платформенного
    репо (первое срабатывание CI-аудита «непинированный action / образ без
    digest → fail» — см. LNB-30 регрессионный тест); сейчас в yml стоят
    теги с комментариями для читаемости драфта.

## Проверки, выполненные над ревизией 2

- 5 JSON-пресетов — валидный JSON; sniffing∈{0,1}; отсутствуют DROP-поля;
  ads-блок у всех builtin; lav-ru.json сгенерирован конвертером-прототипом
  из `lav-ru.source.json` (совпадение с правилами SCHEMA §6 — тестом ядра).
- `lavray.proto` — структурная проверка: 182 сообщения, 36 enum, 13 сервисов,
  85 rpc (10 streaming); нет дублей имён/номеров; reserved-номера не
  конфликтуют с активными полями.
- Все `ci/*.yml` — валидный YAML; `permissions: read` на уровне workflow,
  write — только в релизных job.
