# core-port-plan.md — план портирования C++→Go для ядра LAVRay

> ЧЕРНОВИК Этапа 3 (stage3-drafts), ревизия 2 по L2-ревью 2026-10-23.
> Входные данные: `docs/AUDIT.md` (с поправками аудита 2026-10),
> `docs/REQUIREMENTS.md` (**действующая редакция — 281 FR**, включая раздел 21
> и DROP-решения), `docs/BUGS.md` (LNB-01…36), `docs/THREAT-MODEL.md`,
> `docs/UPDATE-SYSTEM.md` **v2.0**, `docs/OPENWRT-GATEWAY.md`,
> `docs/TEST-PLAN.md`, контракт `../proto/lavray.proto`.
>
> Оценка из аудита: портируется ≈3–6 тыс. строк Go, новое ≈3–5 тыс. + тесты;
> план раскладывает по неделям с критериями готовности.

---

## 1. Цель и границы

**Портируется с C++ на Go** (логика 1:1, формат данных совместим):

| Блок | Источник (nekoray/) | Приёмник (lavray/core/) |
|---|---|---|
| Конфигбилдер | `db/ConfigBuilder.cpp` + `fmt/Bean2CoreObj_box.cpp` | `internal/config/` |
| Модель профилей (beans) | `fmt/*Bean.hpp`, `fmt/AbstractBean.*` | `internal/model/` |
| Share-ссылки туда/обратно | `fmt/Link2Bean.cpp`, `fmt/Bean2Link.cpp` | `internal/model/link/` |
| Хранилище профилей/групп | `db/Database.cpp`, `db/ProfileFilter.cpp` | `internal/store/` (SQLite) |
| Подписки/импорт | `sub/GroupUpdater.cpp`, `main/HTTPRequestHelper.cpp` | `internal/subs/` |
| DataStore (настройки) | `main/NekoGui_DataStore.hpp` | `internal/settings/` |
| Пресеты маршрутов | `main/NekoGui.cpp` (Routing) | `internal/presets/` |

**Переписывается с нуля** (семантика сохраняется, дефекты исправляются):
`go/grpc_server/` → `internal/api/` (ConnectRPC; менеджер инстансов с
мьютексом — AUDIT §7.1.1; graceful — §7.1.2; таймауты — LNB-06),
`fulltest.go` (утечки горутин), `update.go` (TUF-lite v2.0), `updater/`
(на десктопе — rollback-помощник оболочки; в ядре — только ресурсы).

**Берётся как есть**: форк sing-box `628a9ed` (neko-слой по реестру
`lavray/core/NEKO_PATCHES.md`), декриптор защищённых ссылок (+фикс LNB-13), форк x/net.
**Плюс новый патч форка** (LNB-25): hardening `downloadZIP` — запрет `..`,
абсолютных путей и симлинков + лимит размера (вносится в NEKO_PATCHES.md).

**Внешние ядра (решение №5, оспорено L2-ревью — финальное слово за
владельцем)**: в v1 внешние ядра **отключены по умолчанию** (THREAT-MODEL,
FR-UI-175/233–235 DROP). За явным флагом `enable_external_cores` (сборка или
настройка, off по умолчанию, в UI — предупреждение) остаются только **naive**
(FR-UI-095) и **custom-external** (FR-UI-099); hysteria2/tuic — всегда
внутренние sing-box (force_external_core удалён из контракта). При включении
флага обязательны: изоляция (минимальные права, cwd в изолированном каталоге),
секреты конфигов не на диске открытым текстом (env-передача или 0600 + чистка
немедленно, LNB-32), `Pdeathsig=SIGKILL`/Job Object (сироты), лог без
env/argv (LNB-28). Изменение THREAT-MODEL при включении — отдельным решением.

---

## 2. Целевая структура модуля

Один Go-модуль `github.com/anatolijlaptev1991-ctrl/lavray/core` (fix AUDIT
§7.1.7 — два модуля сливаются):

```
core/
  go.mod                      # go 1.25; replace: sing-box, libneko, x/net — пины libs/*.sh
  cmd/lavray-core/main.go     # serve | run -c <config.json> | <команда-расшифровки> <link> | version
  internal/
    config/                   # [W4–W5] ConfigBuilder
      builder.go  merge.go    # MergeJson "+key"/"key+" С ALLOWLIST (§3.1.1)
      outbounds.go dns.go route.go inbounds.go
      testdata/matrix.yaml    # матрица протокол×транспорт×… (TEST-PLAN набор 1)
      testdata/deviations.yaml# осознанные отклонения от oracle (§3.3)
      golden/                 # golden-фикстуры + golden_test.go
    model/                    # [W1] Profile/Group/Settings + bean-иерархия
      profile.go group.go stream.go
      link/                   # [W2] Link2Bean/Bean2Link
    store/                    # [W1] SQLite + мигратор из NekoBox
      store.go migrate.go import_nekobox_test.go
    subs/                     # [W3] подписки: fetch/parse/diff/apply/headers
      fetch.go parse.go clash.go singboxjson.go diff.go snapshot.go
      <пакет расшифровки>/    # порт go/cmd/nekobox_core/<пакет расшифровки> (как есть + LNB-13)
    presets/                  # [W3] формат LAVRay + конвертер NekoRay 4.x
    inst/                     # [W6] менеджер инстанса sing-box (мьютекс, FSM FR-UI-261)
    api/                      # [W6] ConnectRPC-реализации lavray.v1
      interceptors.go errors.go auth.go sessions.go
    web/                      # [W7] HTTP/WS-сервер, статика, сессии (cookie/CSRF)
    diag/                     # [W7] DiagnosticsService: CheckRoute/самопроверки/утечки
    gateway/                  # [W8] исполнитель шлюза OpenWrt
      nft.go                  # fw4-include: таблица inet lavray, исключения, DNS, IPv6
      device.go               # политики per-MAC
      watchdog.go             # нет связи N минут → снять правила → интернет напрямую
    extcore/                  # [W6] внешние ядра — ТОЛЬКО за флагом enable_external_cores
    updates/                  # [W8] TUF-lite клиент (root/timestamp/manifest/sources)
    headless/                 # [W8] headless-режим (сигналы, автостарт, таймеры подписок)
    logging/                  # [W6] мультиплексор логов + redact() (LNB-01/28)
  internal/gen/lavrayv1/      # buf generate (генерится, не редактируется)
```

Сборка: `CGO_ENABLED=0`, теги `with_clash_api,with_gvisor,with_quic,
with_wireguard,with_utls` (+ минимальный набор для «лёгкой» сборки OpenWrt —
OPENWRT-GATEWAY §7). Version-штамп ядра — схема `1.14.1-lav.N` (UPDATE-SYSTEM
§7), версия берётся из пина форка (`libs/get_source_env.sh`), в UI ядро не
называется (fix-plan §4).

`buf.gen.yaml` в корне репо lavray: plugins go/connect-go →
`core/internal/gen`, es/connect-es → `ui/src/api`.

---

## 3. Конфигбилдер (крупнейший блок портирования)

### 3.1 Что переносится (контрольные точки семантики)

1. **MergeJson** (`ConfigBuilder.cpp:32–68`): `+key`/`key+` — конкатенация
   массивов; объекты рекурсивно; скаляры перезаписываются — **но только по
   allowlist, см. §3.1.1**.
2. **Теги outbounds цепочек**: последний → `proxy`, первый → `g-<id>`
   (дедуплицируется), промежуточные → `c-<chainId>-<id>`; `detour`;
   групповой `front_proxy_id` в конец цепочки.
3. **Inbounds**: mixed (listen/port/users), tun (interface_name **lavray-tun**
   — настраиваемое имя, THREAT-MODEL «детект VPN»; auto_route, strict_route,
   mtu 9000, stack, адреса, endpoint_independent_nat), custom_inbound мерж,
   direct-inbound `tag-<id>-mapping`. В режиме TUN mixed-слушатель отключается
   полностью (FR-UI-279: в TUN слушателей на loopback нет вообще).
4. **DNS typed 1.12+/1.14** (`makeDnsServer`): разбор legacy-строк → типи-
   зированные серверы; dns-remote (detour=proxy), dns-direct, dns-local,
   dns-fake (только tun); правила remote/direct-списков (включая `full:`
   адреса серверов цепочки); built-in `query_type 32,33` + `.lan`; 
   `use_dns_object` с валидацией (LNB-08). DROP-поля некора НЕ переносим:
   domain_strategy (FR-UI-131), direct_dns_strategy/dns_final_out
   (FR-UI-148) — в конфиг не влияли; пере-включение — только решение
   владельца (задокументировано в допущениях).
5. **Route** — порядок генерации правил:
   `block → proxy (явные списки) → direct → process_rules пресета →
   tun-bypass (cidr/process) → built-in блокировки → custom`.
   Приоритет proxy перед direct-geosite сохраняет семантику `google.ru`
   (PRESET-LAV-RU §3.3). Whitelist-режим TUN инвертирует ТОЛЬКО tun-списки,
   процессные правила пресета не трогает (поправка ревью №28). Сниффинг —
   только режимы Disable/ForRouting (FR-UI-132 DROP третьего).
   **Kill switch (FR-UI-275, SHOULD)**: в TUN-режиме опционально (off по
   умолчанию) — при падении туннеля весь трафик блокируется (route на block
   + правила фаервола оболочки/помощника); v1.x, в конфигбилдере — флаг
   `tun.kill_switch`.
6. **Rule-set/geo (FR-UI-143, LNB-31/36)**: `geosite:`/`geoip:` → `.srs`
   **из подписанного набора поставки** (geo.json манифеста, sha256), НЕ с
   изменяемой ветки; `download_detour` = активный прокси, если туннель поднят
   (иначе direct); `experimental.cache_file` включён ВСЕГДА (LNB-36) — старт
   без сети работает из кэша/поставки (FR-UI-266).
7. **experimental**: `cache_file` (см. 6); clash_api — по настройке, с
   hardening §6.3; `external_ui_download_url` из пользовательского конфига —
   только после патча downloadZIP (LNB-25).
8. **Внешние ядра** (за флагом, §1): outbound → socks на локальный порт;
   extRs-план с подстановками `%mapping_port% %socks_port% %server_addr%
   %server_port%` (FR-UI-235); автобайпас путей — FR-UI-234.
9. **Режимы**: forTest/forExport (FR-UI-196), internal-full «как есть» (проходит
   allowlist-валидатор), VPN-шаблон Linux — DROP (FR-UI-180: заменён
   внутренним TUN + помощник FR-UI-269).
10. **Mux**: h2mux/smux/yamux + padding + concurrency; только для
    vmess/trojan/vless/ss и не для grpc/quic/tls-http/flow.

### 3.1.1 Allowlist MergeJson (LNB-25, обязательно)

Пользовательский `custom_config` мержится только по белому списку
корневых секций:

- разрешено: `route` (rules/rule_set/default_domain_resolver/…),
  `dns` (кроме полей ниже), `outbounds` (только собственный outbound
  профиля — по тегу), `log.level`, `experimental.cache_file`;
- запрещено всегда: `experimental.clash_api.external_ui_download_url`,
  весь `experimental` кроме cache_file (белым списком подсекций),
  `log.output`, `inbounds` (свои inbounds — только через настройку
  custom_inbound, не через custom_config профиля);
- импортированные профили (подписка/ссылки): мерж `c_cfg`/`c_out` и
  custom core/cmd **отключён** вообще — поля отбрасываются на входе
  парсера (FR-UI-257); ручное включение — preview+diff+подтверждение в UI
  (ImportContent двухфазный, контракт).
- патч форка sing-box: `downloadZIP` — запрет `..`/абсолютных путей/
  симлинков + лимит размера распаковки.

Golden-вектор: «подписка с neko-профилем, содержащим c_cfg с
external_ui_download_url → поля отброшены, предупреждение в preview»
(G33); юнит на allowlist (merge с запрещённым ключом → INVALID_ARGUMENT).

### 3.2 Golden-тесты

Каталог `internal/config/golden/`: вход `*.in.json` (Profile+Group+Settings+
RoutingPreset+режим), эталон `*.want.json`. CI всегда сравнивает; обновление
эталонов — только локально флагом `-update` (LNB-23). **Каждый golden
прогоняется `sing-box check`** (TEST-PLAN набор 2 — ловит класс LNB-35, где
паритет закрепил бы баг) и парсером опций форка.

Матрица входов — `testdata/matrix.yaml` (протокол×транспорт×security×mux×
chain×routing×dns×tun); осознанные отклонения от C++-oracle —
`testdata/deviations.yaml` (§3.3).

| # | Вектор | Что фиксирует |
|---|---|---|
| G01 | socks5 без auth | базовый outbound |
| G02 | socks4 + http c auth | SocksHttpBean обе ветки |
| G03 | ss aes-256-gcm | метод/пароль |
| G04 | ss 2022-blake3-aes-128-gcm + uot v2 | новые методы + udp_over_tcp |
| G05 | ss + plugin `obfs-local;obfs=http` | plugin-строка → plugin-опции sing-box |
| G06 | vmess + ws + tls (sni/alpn/utls chrome) | транспорт ws, tls |
| G07 | vmess + grpc + mux on | multiplex |
| G08 | vmess + httpupgrade + ws early data | early-data поля |
| G09 | vmess + tcp header http | header_type ветка |
| G10 | vless + reality (pbk/sid, flow vision) | REALITY |
| G11 | vless + ws + packet_encoding xudp | packet-addr/xudp |
| G12 | trojan + tls + allow_insecure + сертификат | TLS-блок |
| G13 | trojan + ws + host | транспорт без tls |
| G14 | hysteria2: obfs, up/down Mbps, **server_ports «a:b» + hop_interval «30s»** | FR-UI-268, LNB-35 — имена полей sing-box 1.14 |
| G15 | tuic v5: bbr, native, zero-rtt, ca | QUICBean tuic |
| G16 | chain из 3 + групповой front proxy | теги proxy/g-/c-, detour |
| G17 | custom internal outbound + custom_outbound мерж (allowlist ok) | точки расширения |
| G18 | custom internal-full | конфиг «как есть» после allowlist |
| G19 | custom external (за флагом; mapping inbound, плейсхолдеры) | FR-UI-235 |
| G20 | TUN-конфиг (mtu/stack/strict; mixed-слушатель ОТСУТСТВУЕТ) | FR-UI-184/279 |
| G21 | TUN whitelist-режим (инвертирует только tun-списки) | поправка №28 |
| G22 | kill switch on/off в TUN | FR-UI-275 |
| G23 | geosite:/geoip: → .srs из поставки + cache_file + detour=proxy | FR-UI-143/266, LNB-31/36 |
| G24 | custom_config мерж `+key`/`key+` (allowlist-пути) | MergeJson |
| G25 | DNS: simple раздельный + dns_routing | FR-UI-148/150/155 |
| G26 | DNS: fakeip + tun | FR-UI-151 |
| G27 | DNS: use_dns_object (валидный 1.14) | FR-UI-149 |
| G28 | Пресет **LAV Preset RU** (`presets/lav-ru.json`) | эталон конвертации (PRESET-LAV-RU §3; правило рекламы — §3b) |
| G29 | Пресет **LAV Preset CN** (`presets/lav-cn.json`, rev 2) | CN-гео + ads + процессные |
| G30 | Пресеты **Глобальный**, **Всё через прокси**, **Всё напрямую** | полный набор builtin |
| G31 | forTest-режим | пустые inbounds, без user-правил |
| G32 | sniffing FOR_ROUTING vs DISABLED | FR-UI-132 (третий режим DROP) |
| G33 | **Импорт подписки с c_cfg/c_out/core/cmd → поля отброшены, preview-warning** | FR-UI-257, LNB-25, P0-2 |
| G34 | **Старт с geosite-правилом при выключенной сети — правило применилось из поставки/кэша; повторные старты без сетевых запросов rule-set** | FR-UI-266, LNB-36 |
| G35 | hy2 server_ports: один порт / диапазон / интервал — `sing-box check` exit 0 | FR-UI-268 |

### 3.3 deviations.yaml (обязательное приложение к golden)

Каждое отклонение порта от C++-oracle фиксируется записью:
`{vector, field, oracle_value, lavray_value, reason, bug}`. Стартовый набор:
- `G14 hy2.server_ports/hop_interval` — oracle эмитит `hop_ports`/int
  (LNB-35 — баг), LAVRay — имена sing-box 1.14;
- base64-детектор: некорректный padding — oracle местами прощает, LAVRay
  отвергает (свойство фаззинга);
- share-link кодирование: FullyEncoded-компоненты (oracle Qt- Percent vs
  Go url.Values) — фиксируем канонизацию.

### 3.4 Порядок портирования

1. `merge.go` (allowlist) + тесты → 2. `outbounds.go` (G01–G19) →
3. цепочки/теги (G16) → 4. `inbounds.go` (G20–G22) → 5. `dns.go` (G25–G27)
→ 6. `route.go` + rule_set/geo/kill-switch (G23, G28–G32) →
7. forTest/forExport (G31). Импорт-харденинг G33 — в W3 (§4).

---

## 4. Парсеры подписок и ссылок

### 4.1 Таблица форматов

| Формат | Детекция | Примечания/тесты |
|---|---|---|
| Base64-блоб | `DecodeB64IfValid` (std+urlsafe, автопаддинг) → рекурсия | векторы std/urlsafe/битый; паддинг — в deviations.yaml |
| Clash/Clash.Meta YAML | YAML-парсинг → ключ `proxies` верхнего уровня (НЕ подстрока — LNB-16) | все типы §GroupUpdater.cpp:215–463 + unknown→skip |
| **sing-box JSON подписка** (FR-UI-264, SHOULD) | автопроба: JSON-массив outbounds | W3; UA согласования `LAVRay/<v>` |
| Многострочник | >1 строки после детекций → построчная рекурсия | mixed |
| защищённая ссылка | префикс схемы → внутренний вызов декриптора (не подпроцесс, UX-15) | 38 векторов + LNB-13 |
| Share-ссылки | все схемы FR-UI-120 | roundtrip §4.3 |
| Заголовки ответа (FR-UI-262, MUST) | `subscription-userinfo`, `profile-update-interval`, `profile-title` (base64:), `content-disposition`, `profile-web-page-url`, `support-url`, `announce`, `routing`; строки `#key: value` в теле | → SubscriptionInfo; «Без лимита»/«Бессрочно» выводит UI |
| Нормализация | security none/0/false→""; 1/true→tls; SNI из host при IP; порт>0; SS-метод по списку | LNB-15/17 |

Флоу обновления (порт `GroupUpdater::Update` + FR-UI-258/LNB-29):
- GET: UA `LAVRay/<v>` (или per-sub FR-UI-263), **через туннель по умолчанию**
  (sub_use_proxy=true — LNB-33), `sub_insecure` с предупреждением в лог;
  **раздельные таймауты** (connect 3 c / overall 30 c), **2 ретрая** с
  докачкой; лимит размера 64 МиБ (LNB-12);
- разбор **в промежуточной копии**: 0 профилей или удаление > 50 % →
  не применять, вернуть `PHASE_CONFIRM_REQUIRED` (подтверждение —
  `confirm_destructive`), HTML-заглушка/пустой ответ отвергаются;
- снапшот группы перед применением → `RollbackSubscription`;
- дифф по ключу эквивалентности (FR-UI-249); порядок группы = порядок ответа;
- «последний рабочий источник» (FR-UI-263): успешный URL запоминается,
  при сбое основного пробуется первым;
- HWID-заголовки (FR-UI-265, SHOULD): `x-hwid/x-device-os/x-ver-os/
  x-device-model` — только при явной настройке `sub.hwid_enabled`;
  идентификатор случайный на установку. Реализация W3, политика — допущение.

### 4.2 Валидатор URL (LNB-05)

Схема http/https; резолв цели; приватные/loopback/link-local/ULA/multicast —
запрещены без явного `allow_private_urls`; редиректы своим контролем (≤5,
каждая цель через валидатор). Один и тот же валидатор применяется к URL
подписки и к URL тестов (`TestLatencyRequest.url`).

### 4.3 Fuzzing (TEST-PLAN набор 3)

| Таргет | Инвариант |
|---|---|
| `FuzzParseLink` (каждая схема) | нет паники; результат — error или валидный Profile |
| `FuzzParseClash` / `FuzzParseSingboxJson` | нет паники; unknown → skip; лимит длины |
| `FuzzDecodeB64` | нет паники |
| `FuzzConvertNekoRayRoute` | нет паники; схема валидна |
| `FuzzMergeJson` | нет паники; идемпотентность; allowlist не обходится |

Roundtrip-свойство: `parse(share(profile)) == profile` и
`parse(neko_link(profile)) == profile` — матрица типы×транспорты. CI: 60 с
на таргет (merge-гейт), 10 мин — nightly (TEST-PLAN: 10 мин/цель).

---

## 5. Модель Profile и хранилище

### 5.1 Решение

SQLite (WAL, `modernc.org/sqlite` — CGO-free): транзакционность, SQL-поиск/
теги/дедуп, атомарные бэкапы (`VACUUUM INTO`), headless без фантомных файлов.
**Права (Р2-33)**: каталог данных `0700`, `lavray.db`/токен-файл/бэкапы
`0600` — устанавливаются при создании, проверяются при старте (warning в
журнал при расширении прав).

### 5.2 Схема (миграция 1, `user_version`)

```sql
PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE groups (
  id                INTEGER PRIMARY KEY,
  kind              INTEGER NOT NULL DEFAULT 0,  -- 0 basic | 1 subscription
  name              TEXT    NOT NULL,
  subscription_url  TEXT,
  archive           INTEGER NOT NULL DEFAULT 0,
  skip_auto_update  INTEGER NOT NULL DEFAULT 0,
  front_proxy_id    INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  subscription_info TEXT,                        -- JSON SubscriptionInfo (FR-UI-262)
  update_interval_min INTEGER,                   -- per-sub (FR-UI-263); NULL = глобальный
  user_agent        TEXT,                        -- per-sub UA
  http_headers      TEXT,                        -- JSON map (без секретов)
  http_basic_user   TEXT,
  last_working_url  TEXT,                        -- «последний рабочий источник»
  last_update_ms    INTEGER,
  tab_order         INTEGER NOT NULL,
  ui_state          TEXT,                        -- opaque (column_width и пр.)
  created_at_ms     INTEGER NOT NULL,
  updated_at_ms     INTEGER NOT NULL
);
-- ПОРЯДОК ПРОФИЛЕЙ В ГРУППЕ НЕ ХРАНИТСЯ: канонический источник —
-- profiles.sort_key (Р2-29); Group.profile_order вычисляется (контракт).

CREATE TABLE profiles (
  id                  INTEGER PRIMARY KEY,
  group_id            INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  type                TEXT    NOT NULL,          -- 'socks'...'chain'
  name                TEXT    NOT NULL DEFAULT '',
  address             TEXT    NOT NULL DEFAULT '',
  port                INTEGER NOT NULL DEFAULT 0,
  sort_key            INTEGER NOT NULL,          -- канонический порядок (FR-UI-074); вставка со сдвигом шагом 1024
  favorite            INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  latency_ms          INTEGER,                   -- NULL=не тестировали; <0=unavailable (семантика yc)
  full_report         TEXT,                      -- JSON FullTestReport
  tested_at_ms        INTEGER,
  uplink_total        INTEGER NOT NULL DEFAULT 0,
  downlink_total      INTEGER NOT NULL DEFAULT 0,
  data                TEXT    NOT NULL,          -- канонический JSON: detail-bean + stream + custom_* (сообщение Profile)
  custom_confirmed    INTEGER NOT NULL DEFAULT 0,-- FR-UI-257: custom-поля подтверждены вручную
  legacy_bean         TEXT,                      -- исходный bean NekoBox (на время миграции)
  created_at_ms       INTEGER NOT NULL,
  updated_at_ms       INTEGER NOT NULL
);
CREATE INDEX idx_profiles_group_order ON profiles(group_id, sort_key);
CREATE INDEX idx_profiles_dedup       ON profiles(type, address, port);
CREATE INDEX idx_profiles_favorite    ON profiles(favorite) WHERE favorite <> 0;

CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE profile_tags (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id)      ON DELETE CASCADE,
  PRIMARY KEY (profile_id, tag_id)
);

CREATE TABLE routing_presets (
  id             TEXT PRIMARY KEY,       -- 'lav-ru' | 'custom:my-set'
  builtin        INTEGER NOT NULL DEFAULT 0,
  revision       INTEGER NOT NULL,
  display_name   TEXT NOT NULL,
  data           TEXT NOT NULL,          -- канонический JSON RoutingPreset
  customized     INTEGER NOT NULL DEFAULT 0,
  updated_at_ms  INTEGER NOT NULL
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at_ms INTEGER NOT NULL);

CREATE TABLE sessions (                    -- история трафика (UX-25, GetTrafficSummary)
  id             INTEGER PRIMARY KEY,
  profile_id     INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  group_id       INTEGER NOT NULL,        -- денормализация для сводок по группе
  started_at_ms  INTEGER NOT NULL,
  ended_at_ms    INTEGER,
  uplink_total   INTEGER NOT NULL DEFAULT 0,
  downlink_total INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sessions_group ON sessions(group_id, started_at_ms DESC);
```

Одна транзакция на операцию UI; бэкап при смене версии схемы (ротация 2).
Секреты в `profiles.data` — этап 2 ядра (OS-keychain, LNB-04); сейчас — не
логируются никогда.

### 5.3 Миграция из NekoBox (FR-UI-277)

`cmd/lavray-core import-nekobox <config_dir>`:
1. Читает `groups/nekobox.json` (DataStore → settings по таблице §5.4),
   `groups/pm.json`, `groups/<gid>.json`, `profiles/<id>.json`,
   **`routes_box/<name>`** (поправка аудита 2026-10; каталог `routes/`
   старых форков принимается тоже).
2. Bean → канонический `data`; исходный JSON в `legacy_bean` до верификации;
   **custom-поля (c_cfg/c_out/core/cmd) переносятся ТОЛЬКО в
   `custom_confirmed=0`-виде** и не применяются до подтверждения (LNB-25).
3. Одна транзакция; исходный каталог не модифицируется; **идемпотентно**
   (повторный импорт не дублирует: ключ — id+type+address).
4. Отчёт о потерях (неизвестные типы, битые файлы — с логом, не тихо;
   FR-UI-260: понятная ошибка битого файла).
5. Верификация roundtrip neko-link + golden на корпусе обезличенных конфигов
   (TEST-PLAN набор 5).

### 5.4 Таблица миграции ключей DataStore (56 ключей, Приложение А + extraCore)

| Группа | Ключи NekoBox | Ключ LAVRay | Судьба |
|---|---|---|---|
| Inbound | `inbound_address`, `inbound_socks_port`, `inbound_auth.user/pass`, `custom_inbound` | `inbound.address/port/auth.user/auth.pass/custom_inbound` | переносятся; валидатор FR-UI-279 при не-loopback |
| Тесты | `test_url`, `test_url_dl`, `test_dl_timeout`, `test_concurrent` | `test.url/url_dl/dl_timeout/concurrent` | переносятся; URL — через валидатор LNB-05 |
| Маршрутизация | `active_routing`, `custom_route`, route-set файлы (`direct_ip`…`custom`), `sniffing_mode`, `domain_strategy`, `outbound_domain_strategy`, DNS-поля | `routing.active_preset`, `routing.custom_global`, поля RoutingPreset | `domain_strategy` — DROP (reserved), DNS-поля — по DnsSettings (direct_strategy/final_out DROP) |
| Подписки | `user_agent2`, `sub_use_proxy`, `sub_clear`, `sub_insecure`, `sub_auto_update` | `sub.user_agent`, `sub.use_proxy` (**default true**, LNB-33), `sub.clear`, `sub.insecure`, `sub.auto_update` | переносятся; per-sub переопределения — в Group |
| Запоминание | `remember_id`, `remember_enable`, `spmode2` | `remember.id/enable/modes` | переносятся |
| UI | `theme`, `language`, `mw_size`, `splitter_state`, `start_minimal`, `max_log_line`, `conn_stat`, `log_ignore` | `ui.theme/lang/window_size/splitter/start_minimal/max_log_lines/…` | shell_owned=true; `conn_stat` — всегда true (FR-UI-274) |
| TUN | `fakedns`, `vpn_internal_tun`, `vpn_impl`, `vpn_mtu`, `vpn_ipv6`, `vpn_hide_console`, `vpn_strict_route`, `vpn_bypass_process`, `vpn_bypass_cidr`, `vpn_rule_white` | `tun.fake_dns/enabled/impl/mtu/ipv6/strict_route/bypass_process/bypass_cidr/whitelist/kill_switch` | переносятся; `+tun.kill_switch` (FR-UI-275); interface_name — новое (`tun.interface_name`) |
| Хоткеи | `hk_mw`, `hk_group`, `hk_route`, `hk_spmenu` | `hotkeys.*` (shell_owned) | переносятся |
| Ядро | `core_box_clash_api`, `core_box_clash_api_secret`, `core_box_underlying_dns` | `core.clash_api.enabled/secret/underlying_dns` | clash_api — hardening §6.3 |
| Ядро | `extraCore.core_map` | — | **DROP** (FR-UI-175): внешние ядра за флагом; пути не переносятся |
| Безопасность | `skip_cert`, `utlsFingerprint` | `security.allow_insecure_default/utls_fingerprint` | переносятся |
| Mux | `mux_protocol`, `mux_concurrency`, `mux_padding`, `mux_default_on` | `mux.protocol/concurrency/padding/default_on` | переносятся |
| Прочее | `sp_format`, `check_include_pre`, `traffic_loop_interval`, `current_group`, `old_share_link_format` | `win.sp_format`, `update.include_pre`→каналы v2.0, `stats.interval_ms`, `ui.current_group`, `share.vmess_old_format` | `check_include_pre` → `update.channel` (stable/beta, §9 UPDATE-SYSTEM); `old_share_link_format` теперь персистится (fix FR-UI-164) |
| Новые | — | `update.channel/last_checked_at/serial_stable/serial_beta/root_version`, `web.bind/tls/…`, `sub.hwid_enabled`, `enable_external_cores` | дефолты задаёт DescribeSettings |

---

## 6. Менеджер инстанса, clash-api, внешние ядра

### 6.1 Инстанс

- `internal/inst`: один активный инстанс; **мьютекс** (fix AUDIT §7.1.1);
  FSM `Idle→Connecting→Connected→Disconnecting→Idle/Error` (тексты — FR-UI-261);
  таймауты: Connect 15 с, Disconnect 10 с (LNB-06); `Start` поверх бегущего →
  FAILED_PRECONDITION.
- recover-интерсептор на всех RPC (паника горутины не убивает ядро —
  THREAT-MODEL «паника ядра», LNB-13/32); валидация входа (`Test` с пустым
  конфигом → структурная ошибка).
- Статистика: тик `traffic_loop_interval` (500–5000 мс, 0=off); диффы и
  накопление в ядре; персист тоталов раз в 30 с и при остановке; запись строк
  в `sessions` (сводки по группе — GetTrafficSummary).

### 6.2 Внешние ядра — за флагом `enable_external_cores` (решение №5)

Off по умолчанию (см. §1). При включении: `internal/extcore` — spawn
(`exec.Command` + `Pdeathsig=SIGKILL` (Linux) / Job Object kill-on-close
(Windows) — **сироты невозможны**), cwd — изолированный каталог 0700,
stdout/stderr → лог-мультиплексор (VT100-чистка, source `ext:<name>`),
логирование env/argv запрещено (LNB-28), секреты конфигов — env или 0600 +
немедленная чистка (LNB-32), краш → остановка соединения + CoreEvent. Четвёртая
строка teardown-проверки оболочки — «процессы ext:* мертвы»
(shell-lifecycle §6).

### 6.3 Connection-tracker и clash-api (LNB-18.2 hardening)

- Источник данных соединений — experimental connection-tracker; **HTTP
  clash-api наружу не экспонируется**:
  - включается только по настройке `core.clash_api.enabled`;
  - bind `127.0.0.1:<random>` или unix-socket — НИКОГДА 0.0.0.0;
  - secret — CSPRNG, живёт только в памяти процесса, в конфиг не пишется;
  - `external_ui`/`external_ui_download_url` — off (LNB-25) если не включено
    явно с патчем downloadZIP;
  - CORS без `*`, Origin-проверка (THREAT-MODEL CSRF-строка);
  - альтернатива без HTTP — v2ray-api (решение при реализации W7).

---

## 7. Встроенный сервер (веб-режим) и транспорт десктопа

- **Десктоп: TCP-листенера нет** (THREAT-MODEL §3). ConnectRPC ядро
  обслуживает на UDS (0600, каталог 0700) / named pipe с ACL; оболочка
  получает адрес сокета из ready-строки (shell-lifecycle §3).
- **Веб-режим (OpenWrt)** `internal/web` поверх net/http (chi):
  | Маршрут | Назначение | Auth |
  |---|---|---|
  | `POST /lavray.v1.<Service>/<Method>` | ConnectRPC (proto+JSON) | cookie+CSRF (браузер) / Bearer (headless) |
  | `GET /`, `/assets/*` | статика `go:embed` (ui/dist-web) | — |
  | `GET /api/v1/ws` | WS-мост (core/logs/stats/connections/settings/gateway) | cookie или AUTH-первым-сообщением; **не query** |
  | `GET /healthz` | liveness, без деталей | нет |
  | `GET /api/v1/version` | версии | Bearer/cookie |
- **Bind** — конкретный LAN-адрес из UCI (`lavray.@lavray[0].listen`);
  `0.0.0.0` ядро отвергает без явного `web.allow_all_interfaces`
  (OPENWRT-GATEWAY §6, Р1-8).
- **TLS-бутстрап**: self-signed сертификат, отпечаток SHA-256 отдаётся в
  `WebModeStatus.tls_fingerprint_sha256` и показывается в LuCI при первой
  установке соединения (OPENWRT-GATEWAY §6); HTTP-режим — предупреждение
  «Не защищено» в шапке панели.
- **Сессии (FR-UI-278)**: Argon2id; cookie `HttpOnly; SameSite=Strict;
  Secure`; CSRF-токен на mutating-запросы; per-ACCOUNT backoff с блокировкой
  (5 → задержка, 10 → блок 15 мин; IP-лимит за NAT бесполезен); смена пароля
  отзывает все сессии кроме текущей; сетап первого админа — отдельное окно.
- Заголовки: CSP `default-src 'self'` + `frame-ancestors 'none'`, no-sniff.
- Статика: иммутабельный кэш по хэшу; входной HTML no-cache.

---

## 8. Headless-режим и OpenWrt

- `lavray-core serve --config <dir> [--headless] [--token-file f]
  [--auto-start] [--parent-watch]`: без няньки по умолчанию; токен 0600;
  SIGTERM/SIGINT → graceful Disconnect(collect_stats)+Shutdown; SIGHUP —
  reload настроек; автостарт последнего профиля/режимов (FR-UI-014/186);
  таймеры подписок (≥30 мин, серийно); авторестарт инстанса ≤3 за 60 с, далее
  CoreState.ERROR + событие (не тихое зависание — LNB-21).
- **Шлюз (OPENWRT-GATEWAY §3–5)** — `internal/gateway`:
  - `nft.go`: include для fw4 (`/usr/share/nftables.d/`), таблица `inet
    lavray`, цепочка PREROUTING tproxy на порт ядра (tcp+udp), OUTPUT-
    исключения, исключения `geoip:private`/адреса роутера/DHCP, трафик
    самого lavrayd исключается по `meta skuid` (системный пользователь
    `lavray`) или `meta mark`; перехват DNS (порт 53 → dnsmasq → ядро или
    hijack-dns); IPv6 — отдельная ip6-цепочка, ВЫКЛ по умолчанию;
  - `device.go`: политики per-MAC (GatewayService) — «прокси/напрямую/по
    пресету», гостевая сеть по умолчанию «напрямую»;
  - `watchdog.go`: нет связи N минут (или ядро упало) → **снять правила**
    fw4-include → интернет работает напрямую + уведомление; после
    восстановления — правила возвращаются; watchdog же триггерит откат
    обновления (UPDATE-SYSTEM §6);
  - страж восстановления (FR-UI-270): на старте снимаются осиротевшие
    правила и TUN.
- Пакеты: `lavrayd` / `lavray-webui` / `luci-app-lavray`; procd
  `respawn 3600 5 0`; uci `/etc/config/lavray`; статусы/логи в tmpfs;
  GOMEMLIMIT/GOGC из UCI (§7 OPENWRT-GATEWAY).

---

## 9. Порядок работ (недели) и определения готовности

### W1 — Каркас, модель, хранилище
Go-модуль; `internal/model` (bean-иерархия, hy2: server_ports/hop_interval);
SQLite-схема + **права 0700/0600**; импортёр NekoBox (routes_box, §5.3–5.4).
**Готово**: тесты model/store зелёные; миграция эталонного каталога — отчёт
100% известных типов; roundtrip neko-link; **`buf generate`**; права
проверяются тестом.

### W2 — Ссылки (Link2Bean/Bean2Link)
Все схемы; нормализация (LNB-15/17).
**Готово**: roundtrip-матрица; `FuzzParseLink` 60 с чисто; FR-UI-190/191/164.

### W3 — Подписки-парсер + пресеты + импорт-харденинг
Base64/Clash/**sing-box JSON**/защищённые ссылки; валидатор URL; лимит размера;
дифф-флоу **в промежуточной копии** + снапшот/rollback + confirm_destructive
(FR-UI-258); **заголовки FR-UI-262 + per-sub FR-UI-263 + HWID opt-in**;
**LNB-25: отбрасывание c_cfg/c_out/core/cmd + preview**; конвертер
NekoRay-маршрутов; все 5 builtin-пресетов.
**Готово**: фикстуры всех типов; G33 зелёный; `RU-bypass + Games` конверт-
golden; фаззинг парсеров чисто; мок-заглушка 200+HTML → группа сохранена.

### W4 — Конфигбилдер I (merge-allowlist, outbounds, цепочки)
§3.4 шаги 1–3; G01–G19 (кроме inbounds-зависимых).
**Готово**: merge-allowlist юниты (запрещённые ключи → INVALID_ARGUMENT);
G01–G16 + sing-box check зелёные.

### W5 — Конфигбилдер II (inbounds/DNS/route/geo/kill-switch/hy2-hop)
§3.4 шаги 4–7; G17–G32; **cache_file + .srs из поставки + detour=proxy +
G34 старт без сети**; kill-switch флаг; **G35 hy2 server_ports — матрица
один порт/диапазон/интервал + `sing-box check`** (FR-UI-268, LNB-35).
**Готово**: G01–G35 зелёные в CI; LAV RU/CN/Global/AllProxy/AllDirect
конфиги валидны.

### W6 — Инстанс-менеджер, ConnectRPC-API I, логи, внешние ядра (флаг)
`internal/inst` (§6.1), recover-интерсептор; Core/Profile/Group/Subscription/
Routing/DNS/Settings-сервисы; лог-мультиплексор + redact() (LNB-01/28);
`internal/extcore` за флагом (Pdeathsig/Job, изоляция).
**Готово**: e2e Connect→stats→Disconnect на UDS/pipe; `-race` чисто;
redaction-тест «секрета нет ни в одной строке»; ext-сирот нет (kill -9
родителя → дети мертвы).

### W7 — Веб-сервер, WS, статистика, соединения, тесты, диагностика
`internal/web` (§7: bind UCI, cookies/CSRF, backoff per-account, TLS-отпечаток);
StatsService push + GetTrafficSummary; ConnectionService (**tracker,
clash-api hardening §6.3**); TestLatency (переписанный fulltest);
**`internal/diag`** (CheckRoute/самопроверки 8 шт/GetPublicIp/CheckLeaks —
FR-UI-271/272/273).
**Готово**: веб-сценарий вход→профили→connect→скорости→логи; CSRF/Origin-
автотесты (TEST-PLAN набор 6); тест утечек на стенде; `0.0.0.0` без флага
отвергается тестом.

### W8 — Headless, шлюз, обновления (TUF-lite v2.0), стабилизация
`internal/headless`; **`internal/gateway` (nft.go/device.go/watchdog.go)**;
`internal/updates`: **полный клиент UPDATE-SYSTEM v2.0** — root (порог
2-из-3, ротация, отзыв ключей), timestamp (параллельно ≥2 источника, expires
≤ 7 дней), manifest (product/channel/serial/expires/mandatory, presets rev,
geo sha256), **sources.json (никакого URL-пиннинга в коде)**, порядок сети
туннель→напрямую, **last_checked_at + статусы свежести**, офлайн-файл,
CORE отдельно по `minApp` (схема 1.14.1-lav.N), негативные тесты §10
(downgrade-артефакт, чужой product/channel, freeze, zip-slip). Нагрузочные
(1000 профилей, 200 соединений) и негативные прогоны.
**Готово**: все негативные кейсы §10 v2.0 зелёные в CI-контейнерах;
headless под procd/systemd переживает SIGTERM без зависших TUN/правил
(страж FR-UI-270); шлюз: watchdog снимает правила при «нет связи» (стенд);
все гейты W1–W7 зелёные; `buf breaking` чисто.

---

## 10. Риски, допущения и отложенное (на ревью/владельцу)

1. modernc/sqlite: бенчмарк-бюджет на 10⁴ профилей — W1 (запасной путь
   отвергнут, см. ревизию 1).
2. `ui-dist`: embed в бинарь; на OpenWrt — пакет `lavray-webui` (тег
   `without_webui`), WEBUI_DIST — фиксированный каталог сборки, не env.
3. `profiles.data` — канонический JSON контракта (не колонки): ALTER на
   каждое изменение контракта не нужен.
4. **Внешние ядра — решение владельца** (оспорено ревью): v1 = naive +
   custom-external за флагом off-by-default; hy2/tuic внутренние. При
   сохранении полного отказа — удалить extcore и флаг (упрощение).
5. ключи расшифровки: правовой статус LNB-24 — до релиза (не до портирования).
6. **Kill switch (FR-UI-275, SHOULD)**: реализуется в W5 (флаг
   tun.kill_switch, off по умолчанию); полная блокировка при падении
   туннеля требует координации с помощником/фаерволом — эскиз в
   shell-lifecycle §7.
7. **HWID (FR-UI-265, SHOULD)**: реализуется W3 как opt-in; случайный
   per-install ID; реестрация UA в панелях Marzban/Remnawave/PasarGuard —
   вне кода (документация).
8. **Доп-протоколы (FR-UI-267, SHOULD)**: AnyTLS/ShadowTLS/WireGuard/SSH/
   Hysteria v1, TLS fragment/ECH, reality_spx — ОТЛОЖЕНО после v1; поля
   контракта (NETWORK_QUIC, reality_spx) зарезервированы.
9. **XHTTP (FR-UI-281)** — триада решений владельца (форк ядра / Xray как
   доп-ядро / отказ с понятным сообщением); в v1 — понятное сообщение
   «протокол не поддерживается».
10. Персистентный event-log для хвостов Stats/подписок — задел на будущее
    (сейчас оговорки контракта).
