# Аудит Go-ядра NekoBox и связки с UI (для проекта LAVRay)

Дата: 2026-10-22. Объект: `D:/ZCode/nekobox/nekoray` (ветка `feature/singbox-upgrade`, версия `4.0.1-happ.4-sb114`), форк sing-box `anatolijlaptev1991-ctrl/sing-box`, пин `COMMIT_SING_BOX=628a9ed70b…` (= **1.14.1-neko.1**), libneko `1c47a3af`, форк x/net `9f3d514b`.

## 0. Поправки аудита 2026-10

Повторная проверка (2026-10-23, сырые отчёты `docs/audit-2026-10/raw/01–04`, основной отчёт `docs/AUDIT-CLAUDE-2026-10.md`) уточнила и опровергла ряд утверждений этого документа. Поправки внесены по тексту с пометкой «(поправка 2026-10)»; сводка:

| Где | Было | Стало |
|---|---|---|
| §1.2 | 7 RPC без оговорок | Плюс непрочитываемое поле `TestReq.inbound` (=4) и устаревшее `full_nat` (=11) — `rpc/libcore.proto`:44, 55 |
| §1.3 | Start/Stop корректны | Повторный Start при живом инстансе осиротит sing-box (defer ставит `instance=nil`), Close без таймаута — `go/cmd/nekobox_core/grpc_box.go`:33-48, 78-86 |
| §1.3 | Нянька завершает `os.Exit(0)` | `log.Fatalln` → код 1 — `go/grpc_server/grpc.go`:48-58 |
| §2.1 | Профиль хранит `traffic:{id,tag,uplink,downlink,last_update}` | Персистятся только `dl`, `ul` — `db/traffic/TrafficData.hpp`:15-17 |
| §2.1 | Длинные имена полей бинов | Ключи короткие: `_v,name,addr,port,c_cfg,c_out`; stream: `net,sec,pac_enc,path,host,sni,alpn,cert,insecure,h_type,ed_name,ed_len,utls,pbk,sid,spx,mux_s` — `fmt/AbstractBean.cpp`:8-16 |
| §2.2 | Дерево `routes/<name>` | `config/routes_box/<name>`; настройки — `groups/nekobox.json` |
| §2.2 | ~70 настроек DataStore | 56 ключей + `extraCore{core_map}` и `inbound_auth{user,pass}` |
| §3 | MergeJson `+k/k+` = конкатенация | `+k` — источник перед, `k+` — после; без маркера массив заменяется, объект сливается |
| §3 | Legacy-DNS убран полностью | Верно для билдера; шаблон внешнего TUN содержит outbound `dns` и не стартует |
| §5 | Апдейтер защищён от zip-slip | Неверно: `codeclysm/extract` v2.2.0 без проверки путей; `safeJoin` появился в v3.1.0 |
| §6 | Happ «без паник» | Неверно: `body[14:22]` паникует при длине тела 13–21 — `happdecrypt.go`:250-269 (LNB-13) |
| §7.0 | sing-box на `b47a09e` без neko-слоя | Устарело (2026-10, аудит): HEAD `628a9ed`, есть `box_neko.go`, `boxapi/` |
| §8 | Билдер «~850+240 строк, 1:1» | Ядро порта 4 444 строки C++ (таблица из сырого отчёта 02, §2.1); перенос 1:1 закрепит дефекты (hy2 `hop_ports`, нет `cache_file`) |
| §9 | 3–6 тыс. строк, 4–8 недель | 5–7 тыс. строк Go без тестов; плюс oracle, импортёр NekoBox, санитайзер логов, SSRF-безопасный fetcher, супервизор |
| §9.1 | HTTP-API: `0.0.0.0` + статичный токен, TLS опционально; `Start(core_config)` | Десктоп — без TCP (IPC Tauri + unix-socket/named pipe); веб — вход с паролем, привязка к адресу LAN, HTTPS; API на сущностях, без сырого конфига (сырой отчёт 03, §4) |

> Контекст прежних аудитов: `nekoray/AUDIT.md` (happ-декриптор, база 4.0.1) и `nekoray/AUDIT-SB.md` (миграция sing-box 1.9.7→1.13.21). С тех пор ядро переведено на **sing-box 1.14.1**: `db/ConfigBuilder.cpp` уже генерирует DNS в новом typed-формате 1.12+/1.14 (`makeDnsServer`), legacy-формат полностью убран из генератора.

---

## 1. Архитектура Go-ядра как есть

### 1.1 Процессы

```
┌────────────────────────────┐        spawn (QProcess, DS_cores-поток)        ┌─────────────────────────────┐
│  nekobox.exe  (Qt C++ GUI) │ ─────────────────────────────────────────────► │  nekobox_core  (Go)          │
│                            │   argv: nekobox -port <p> [-debug]             │                              │
│  main/main.cpp             │   stdin: <token>\n   (рандом 32 симв.)         │  go/cmd/nekobox_core/main.go │
│  ui/mainwindow.cpp         │                                                │   ├ режим "nekobox" → grpc    │
│  ui/mainwindow_grpc.cpp    │                                                │   ├ режим CLI sing-box        │
│  db/ConfigBuilder.cpp      │                                                │   └ режим happ-decrypt        │
│  sub/GroupUpdater.cpp      │                                                │                              │
│  rpc/gRPC.cpp (самописный  │ ◄──── gRPC over HTTP/2 (127.0.0.1:<port>) ───► │  grpc_server.RunCore         │
│  gRPC-клиент на QNAM)      │        заголовок nekoray_auth: <token>         │  LibcoreService (7 методов)  │
└────────────────────────────┘                                                │                              │
      │                                                                       │  boxmain.Create() → sing-box │
      │ exit_reason=1 → startDetached("./updater")                            │  instance *box.Box (глоб.)   │
      ▼                                                                       └─────────────────────────────┘
┌────────────────────────────┐
│  updater / launcher (Go)   │   go/cmd/updater: распаковка nekoray.zip → замена файлов → рестарт nekobox
└────────────────────────────┘
```

Три бинарника: **nekobox.exe** (GUI), **nekobox_core** (Go-ядро: gRPC-сервер + обычный sing-box CLI + happ-decrypt CLI), **updater/launcher** (Go, самозамена + Linux-лаунчер с LD_LIBRARY_PATH для упакованного Qt).

Потоки в Go-ядре: главный (gRPC serve), горутина-нянька родителя (Windows: `parent.Wait()`; Unix: `Signal(0)` каждые 10 с → при смерти GUI нянька завершается через `log.Fatalln`, то есть с кодом 1, а не `os.Exit(0)` — поправка 2026-10, `go/grpc_server/grpc.go:48-58`), горутины sing-box (роутер, инбаунды), горутины fulltest. Никакой дополнительной синхронизации между RPC-методами нет — единственный клиент GUI, гонки практически исключены сценарием, но не кодом (см. §7).

Потоки в GUI: UI-поток, `DS_cores` (QProcess ядра и внешних ядер), поток `TrafficLooper::Loop()` (опрос статистики), пул потоков спидтеста (`test_concurrent`, по умолчанию 5), потоки обновления подписок.

### 1.2 gRPC-API — полный список методов

Proto: `go/grpc_server/gen/libcore.proto`, package `libcore`, сервис `LibcoreService` (go_package `grpc_server/gen`). Генерация: `update_proto.sh` (protoc, go + go-grpc). Go-модуль `grpc_server` — **отдельный модуль** (go 1.19, grpc v1.49.0), подключён в `nekobox_core` через `replace grpc_server => ../../grpc_server`.

| # | RPC | Запрос | Ответ | Реализация / поведение |
|---|-----|--------|-------|------------------------|
| 1 | `Exit` | `EmptyReq {}` | `EmptyResp {}` | `grpc_server/grpc.go` — мгновенный `os.Exit(0)`. Инстанс sing-box **не закрывается** (Close не вызывается) |
| 2 | `Update` | `UpdateReq {action: Check\|Download; check_pre_release}` | `UpdateResp {error; assets_name; download_url; release_url; release_note; is_pre_release}` | `grpc_server/update.go` — GitHub API `repos/anatolijlaptev1991-ctrl/nekoray/releases`; Download → `../nekoray.zip` |
| 3 | `Start` | `LoadConfigReq {core_config: string; enable_nekoray_connections: bool (мёртвое поле, ядром не читается); stats_outbounds: []string}` | `ErrorResp {error}` | `cmd/nekobox_core/grpc_box.go` — `boxmain.Create([]byte(core_config))`; при `stats_outbounds` добавляет v2ray-трекер `Router().AppendTracker(NewStatsService(...))`; лог-райтер подменяется на `neko_log.LogWriter` |
| 4 | `Stop` | `EmptyReq {}` | `ErrorResp {error}` | `instance_cancel(); instance.Close(); instance=nil; statsService=nil` |
| 5 | `Test` | `TestReq {mode: TcpPing\|UrlTest\|FullTest; timeout; address; config: LoadConfigReq; url; in_address; full_latency; full_speed; full_speed_url; full_speed_timeout; full_in_out; full_udp_latency}` | `TestResp {error; ms; full_report}` | TcpPing: `speedtest.TcpPing`; UrlTest: временный или бегущий инстанс + `speedtest.UrlTest` (RTT); FullTest: временный инстанс + `grpc_server.DoFullTest` (латентность/UDP-DNS 8.8.8.8/скорость скачивания/вход-выход IP, отчёт строкой) |
| 6 | `QueryStats` | `QueryStatsReq {tag; direct: "uplink"\|"downlink"}` | `QueryStatsResp {traffic: int64}` | `boxapi.QueryStats(statsService, "outbound>>><tag>>>traffic>>><direct>")`, счётчик читается со сбросом (diff за такт считает UI) |
| 7 | `ListConnections` | `EmptyReq {}` | `ListConnectionsResp {nekoray_connections_json}` | **Заглушка** — всегда пусто (`TODO upstream api`). UI-фича connection_statistics фактически мертва |

Все методы unary. Стримов нет — логи по gRPC не передаются (см. 1.4), статистика тянется поллингом UI. **Поправка 2026-10:** контракт содержит ещё два мёртвых поля, не описанных выше: непрочитываемое `TestReq.inbound` (=4) и устаревшее `full_nat` (=11) — `rpc/libcore.proto:44, 55`.

**Start/Stop — не полностью корректны (поправка 2026-10):** повторный `Start` при живом инстансе осиротит sing-box (defer ставит `instance=nil`, `Stop` после этого — no-op), а `Close` вызывается без таймаута и ошибка игнорируется — `go/cmd/nekobox_core/grpc_box.go:33-48, 78-86`.

### 1.3 Жизненный цикл запуска/остановки

Запуск (GUI → ядро):
1. GUI генерирует `core_token` (32 случайных символа) и случайный `core_port` (`MkPort()`, фолбэк 19810), создаёт `CoreProcess` (наследник QProcess) с cwd `./config`.
2. `CoreProcess::Start()` пишет токен в **stdin** ядра. Ядро (`RunCore`) при пустом `-token` читает токен из stdin; слушает `127.0.0.1:<port>`; печатает в stdout `nekobox_core grpc server listening at …`.
3. GUI по подстроке `grpc server listening` в stdout выставляет `core_running=true` и запускает отложенный профиль (`start_profile_when_core_is_up`, работает и для «remember last profile»). Подстрока `failed to serve` → kill процесса ядра. stderr показывается только после `token is set`.
4. Краш ядра: автоперезапуск с rate-limit 10 с; слишком частые падения — прекращение перезапуска.

Запуск профиля (`MainWindow::neko_start`):
1. `BuildConfig(ent)` в C++ (см. §3) → JSON sing-box.
2. RPC `Start(LoadConfigReq)`; `stats_outbounds=["proxy","bypass"]` при включённом трафик-цикле.
3. Внешние ядра (Naive и custom-external): стартуются как QProcess после Start, в outbound-конфиге вместо них локальный socks.
4. `TrafficLooper` включается: поток раз в `traffic_loop_interval` (500–5000 мс, по умолчанию 1000) вызывает `QueryStats` по тегам outbounds, копит uplink/downlink/rate, обновляет UI и сохраняет в профиль.

Остановка: `neko_stop` → kill внешних ядер → финальный опрос статистики + сохранение → RPC `Stop`. Выход из приложения: `prepare_exit` → `Stop` → RPC `Exit` (ядро умирает `os.Exit(0)`) → при `exit_reason==1` запускается `updater`.

### 1.4 Обмен логами и статистикой с UI

- **Логи**: не через gRPC. Ядро подменяет writer лог-фабрики sing-box на `neko_log.LogWriter` (кольцевой буфер 50 КиБ + файл `./neko.log`, cwd ядра = `config/`), но UI читает просто stdout/stderr QProcess (`MW_show_log`), с лимитом `max_log_line` строк. Т.е. канал логов = пайп процесса.
- **Статистика**: поллинг `QueryStats` из `TrafficLooper` (см. выше), дифы считаются на C++. Никакого push.
- **Соединения**: `ListConnections` — заглушка, UI получает пустой массив.

### 1.5 Форк sing-box (neko-слой)

Пин `628a9ed70b` = **1.14.1-neko.1** (base — upstream 1.14.1/testing). Neko-слой (по `git show` этого коммита; в рабочей копии он сейчас НЕ выведен — см. §7.0):

- `cmd/sing-box/*`: `package main` → `package boxmain` (~101 файл), `main()` → `Main()`.
- `cmd/sing-box/neko_run.go`: `Create(configBytes) (*box.Box, context.CancelFunc, error)` — парсинг через `options.UnmarshalJSONContext(include.Context(...))` (в 1.14 контекст обязан нести реестры транспортов), `box.New` + `Start`; `SetDisableColor`.
- `box_neko.go`: `SetLogWritter(w io.Writer)` — reflect-хак по полю `writer` лог-фабрики; `NekoDialContext`/`NekoDialUDP` — диал через default outbound инстанса.
- `boxapi/`: `go_http.go` (`CreateProxyHttpClient(box)`), `go_net.go` (`DialContext`/`DialUDP`), `stats.go` (`NewStatsService`, `QueryStats` с `Reset_: true` — обёртка над `experimental/v2rayapi`).
- `constant/version.go`: `Version = "1.14.1-neko.1"`.

Replace-цепочка в `go/cmd/nekobox_core/go.mod` (go 1.25.5): `sing-box → ../../../../sing-box`, `libneko → ../../../../libneko`, `x/net → ../../../../net` (форк с фиксом http2 StreamError, golang/go#80567), `grpc_server → ../../grpc_server`. Сборка: `CGO_ENABLED=0`, теги `with_clash_api,with_gvisor,with_quic,with_wireguard,with_utls`, ldflags `-X ...neko_common.Version_neko=nekoray-<version>`.

---

## 2. Модель данных профилей

### 2.1 Структуры

`ProxyEntity` (db/ProxyEntity.hpp + Database.cpp) — единица профиля, JsonStore:
```
{ "type": "socks|http|shadowsocks|vmess|trojan|vless|naive|hysteria2|tuic|custom|chain",
  "id": int, "gid": int,                 // gid — группа
  "yc": int,                             // latency (мс; <0 unavailable, 0 не тестировали)
  "report": string,                      // full_test_report
  "bean": {…},                           // полиморфная часть по типу
  "traffic": {id, tag, uplink, downlink, last_update} }   // поправка 2026-10: персистятся только dl, ul — db/traffic/TrafficData.hpp:15-17
```

Bean-иерархия (`fmt/`): общий предок `AbstractBean {version, name, serverAddress, serverPort, custom_config, custom_outbound}`; у «v2ray-подобных» встроен `V2RayStreamSettings {network(ws/grpc/http/httpupgrade/tcp+header), security(none/tls), sni, host, path, header_type, certificate, allow_insecure, alpn, utlsFingerprint, reality_pbk, reality_sid, ws_early_data_*, multiplex_status, packet_encoding}`. **Поправка 2026-10:** в JSON имена полей не длинные, а короткие: базовый бин — `_v,name,addr,port,c_cfg,c_out`; stream — `net,sec,pac_enc,path,host,sni,alpn,cert,insecure,h_type,ed_name,ed_len,utls,pbk,sid,spx,mux_s`; далее `method,pass,plugin,uot` (ss), `id,aid,sec` (vmess), `pass,flow` (trojan/vless), `v` (socks), `core,cmd,cs,cs_suffix,mapping_port,socks_port` (custom) — `fmt/AbstractBean.cpp:8-16`.

| Bean | Типы | Специфичные поля |
|---|---|---|
| `SocksHttpBean` | socks (4/5), http | username/password, socks_http_type |
| `ShadowSocksBean` | shadowsocks | method, password, uot (udp-over-tcp), plugin (obfs-local/v2ray-plugin строкой с `;`) |
| `VMessBean` | vmess | uuid, aid, security |
| `TrojanVLESSBean` | trojan, vless | password/uuid, flow |
| `QUICBean` | hysteria2, tuic | password/uuid, hopPort, obfsPassword, upload/downloadMbps, congestionControl, udpRelayMode, zeroRttHandshake, disableSni, heartbeat, uos, alpn, caText, sni, allowInsecure |
| `NaiveBean` | naive (внешнее ядро) | — |
| `CustomBean` | custom | core: `internal` \| `internal-full` \| external-программа; config_simple, command; mapping_port, socks_port |
| `ChainBean` | chain | list[] — id профилей в цепочке |

`Group` (db/Group.hpp): `{id, name, url (подписка), info (Subscription-UserInfo), order[] (порядок профилей), archive, skip_auto_update, front_proxy_id (групповой front-proxy), lastup, column_width[]}`.

`DataStore` (main/NekoGui_DataStore.hpp) — настройки приложения (в этом аудите оценено как «~70»; поправка 2026-10: 56 ключей, плюс вложенные `extraCore{core_map}` и `inbound_auth{user,pass}` — `main/NekoGui.cpp:230-285`): порты inbound, VPN/TUN (mtu, stack, strict_route, правила process/cidr, белый список), routing-имена, DNS, mux, тесты, подписки, hotkey, clash_api и т.д. `Routing` — отдельный JsonStore с 6 списками правил (proxy/direct/block × domain/ip), DNS-настройками, `custom` JSON.

### 2.2 Сериализация и хранение

Механизм: самописная «рефлексия» `JsonStore` — `_add(configItem{name, void* ptr, itemType})`, `ToJson()/FromJson()` обходят карту. Типы: string, integer, integer64, boolean, stringList, integerList, jsonStore (вложенный). Никаких schema-версий, кроме `bean->version == -114514` как маркера «тип неизвестен» (битый профиль удаляется при загрузке).

Хранение — **плоские JSON-файлы** в cwd GUI (`config/`), никакой БД:
```
config/
  groups/nekobox.json   — DataStore (все настройки)
  groups/pm.json        — ProfileManager {groups: [порядок табов]}
  groups/<gid>.json     — Group
  profiles/<id>.json    — ProxyEntity
  routes_box/<name>     — Routing (поправка 2026-10: каталог называется routes_box/, без расширения; активный — groups/nekobox.json:active_routing)
```
ID — сквозные инкременты (`profilesIdOrder.last()+1`); `-flag_reorder` пересоздаёт нумерацию (с удалением файлов). `TrafficData` каждого профиля (суммарный трафик) пишется в тот же файл профиля.

---

## 3. Конфигбилдер (профиль → конфиг sing-box)

**Важно для LAVRay: конфигбилдер целиком живёт в C++ GUI** (`db/ConfigBuilder.cpp`, 846 строк + `fmt/Bean2CoreObj_box.cpp`, 237 строк), а не в Go-ядре. Ядро получает уже готовый JSON строкой. Для headless-режима LAVRay это главный кандидат на перенос в Go.

Вход: `BuildConfig(ent, forTest, forExport)`; для `CustomBean{core:"internal-full"}` — конфиг берётся как есть из `config_simple`. Затем `MergeJson`-мерж `bean->custom_config` поверх. **Поправка 2026-10 о семантике MergeJson:** `+k` ставит источник ПЕРЕД назначением, `k+` — ПОСЛЕ; без маркера массив заменяется целиком, объект рекурсивно сливается; `+k` с не-массивом остаётся литеральным ключом — `db/ConfigBuilder.cpp:32-69`.

`BuildConfigSingBox` генерирует (формат sing-box **1.14**):

- **log**: `{level: dataStore->log_level}`.
- **inbounds**:
  - `mixed-in` (type `mixed`, `listen` 127.0.0.1/настраиваемый, порт 2080, опционально users с парой логин/пароль);
  - `tun-in` (type `tun`, `interface_name` neko-tun / utun9 на macOS, `auto_route`, `strict_route`, `mtu` (9000), `stack` = gvisor/system/mixed, `address` `["172.19.0.1/28"(, v6)]`, `endpoint_independent_nat`) — только при VPN-режиме с internal tun;
  - `custom_inbound` из настроек (мерж);
  - для внешних ядер — direct-inbound `tag-<id>-mapping` с `override_address/override_port` на реальный сервер (чтобы цепочки работали через внешний процесс);
  - в forTest — inbounds пустые.
- **outbounds**: разбор цепочек (`ChainBean.list` разворачивается, групповой `front_proxy_id` добавляется в конец); теги: последний (выбранный) профиль → `proxy`, первый → `g-<id>` (глобальный, дедуплицируется), промежуточные → `c-<chainId>-<id>`; связи через `detour`. Каждый профиль → `bean->BuildCoreObjSingBox()` (все протоколы, transport ws/grpc/http/httpupgrade+early-data, TLS/Reality/uTLS, packet_encoding, uot, plugin SS, hysteria2 hop ports и т.д.); внешние ядра → socks-outbound на локальный порт внешнего процесса. Сервисные: `direct`, `bypass`, `block`. mux (multiplex h2mux/smux/padding, только для vmess/trojan/vless и не для grpc/quic/tls-http/flow). `domain_strategy` из routing. Мерж `custom_outbound`.
- **dns** (typed-формат 1.12+): `makeDnsServer` разбирает legacy-строку адреса (`local`, `fakeip`, `udp://`, `tls://`, `https://`(+path), `h3://`, `quic://`, `tcp://`, `dhcp://`, `[v6]:port`) в типизированный объект. Серверы: `dns-remote` (detour = тег proxy), `dns-direct`, `dns-local` (underlying, по умолчанию `local`), опционально `dns-fake` (fakeip, только tun). Правила: домены remote-списка → dns-remote, direct-списка → dns-direct (включая `full:<server>` адреса всех профилей цепочки — чтобы резолвились напрямую), built-in: `query_type 32,33` и `.lan` → predefined NOERROR; tun → dns-fake. Опция `use_dns_object` подменяет секцию пользовательским JSON.
- **route**: первое правило — `action: sniff` (для mixed-in/tun-in, 3s) при включённом сниффинге; `protocol: dns → action: hijack-dns`; пользовательские списки (v2ray-синтаксис: `geosite:`/`geoip:` → remote **rule_set** `.srs` с MetaCubeX/meta-rules-dat, download_detour=direct, дедупликация; `full:`→domain, `domain:`→domain_suffix, `regexp:`, `keyword:`, прочее→suffix) → block/proxy/bypass; built-in блокировки (udp 135/137/138/139/5353, multicast 224.0.0.0/3, ff00::/8, source-ip то же); tun-правила process_name/cidr (bypass или whitelist-режим); автобайпас путей внешних процессов; мерж custom_route и глобального custom; `default_domain_resolver {server: dns-direct, strategy}`, `auto_detect_interface = vpn`, `final = def_outbound`, `rule_set` — определения.
- **experimental**: `clash_api` (127.0.0.1:9090, secret, external_ui dashboard) — по настройке. Дашборд кладётся рядом с бинарём.

Отдельные режимы: `WriteVPNSingBoxConfig()` — рендер шаблона `res/vpn/sing-box-vpn.json` (внешний TUN как root, Linux) с плейсхолдерами; `WriteVPNLinuxScript()`. **Поправка 2026-10:** хотя legacy-DNS действительно убран из билдера, сам VPN-шаблон содержит удалённый outbound `dns` (sing-box 1.14 его отвергает — `option/outbound.go:55-58`) и не стартует; внешний TUN в LAVRay не переносится (см. REQUIREMENTS FR-UI-180).

Результат сборки: `BuildConfigResult {coreConfig, outboundStats[] (теги для статистики), outboundStat (главный), ignoreConnTag[], extRs[] (внешние ядра: программа/аргументы/окружение)}` — UI стартует extRs как процессы, теги отдаёт TrafficLooper.

---

## 4. Парсеры подписок (sub/GroupUpdater.cpp, C++)

Диспетчер `RawUpdater::update(str)`:
1. **happ://** — перехватывается раньше всего в `GroupUpdater::AsyncUpdate`: фоновый запуск `nekobox_core happ-decrypt` (подпроцесс, JSON `{ok,result|error}` на stdout), затем рекурсивный вход в обычный флоу с расшифрованным содержимым.
2. **Base64-блоб** (`DecodeB64IfValid`) → декодирование и рекурсия (типичный v2ray-сабскрипшн).
3. **Clash YAML** — если строка содержит `proxies:` → `updateClash` (yaml-cpp): ss/ssr (cipher, password, plugin obfs/v2ray-plugin, udp-over-tcp, smux), socks5/http (tls, skip-cert-verify), trojan/vless (flow/uuid, network, sni/servername, alpn, client-fingerprint + глобальный фолбэк, reality-opts, ws-opts c early-data, grpc-opts, smux, packet-addr/xudp), vmess (uuid/alterId/cipher, ws/grpc/h2/http-opts c трюком `?ed=` в path, xudp), hysteria2 (ports, obfs-password, up/down), tuic (uuid/password, congestion-controller, udp-relay-mode, reduce-rtt, alpn, ip-override). Неизвестный тип → skip.
4. **Многострочник** → построчная рекурсия.
5. **Единичные ссылки**: `nekoray://` (собственный формат: host=тип, fragment=base64url(bean JSON)), `socks5:// socks4:// socks4a:// socks://`, `http(s)://`, `ss://`, `vmess://` (base64-JSON), `vless://`, `trojan://`, `naive+*`, `hysteria2://|hy2://`, `tuic://` — каждая через `TryParseLink` соответствующего bean (`fmt/Link2Bean.cpp`).
6. `RawUpdater_FixEnt` — нормализация (`security: none/0/false→""`, `1/true→tls`; SNI из host при IP-адресе).

Обновление подписки (`GroupUpdater::Update`): HTTP GET (User-Agent `NekoBox/PC/<v> (Prefer ClashMeta Format)` или пользовательский, опционально через прокси инбаунда, `sub_insecure`, таймаут 10 с, NoLessSafeRedirectPolicy), заголовок `Subscription-UserInfo` → `group->info`; диф старых/новых профилей через `db/ProfileFilter` (по эквивалентности), порядок — как в ответе; режимы: `sub_clear` (снести всё перед импортом) или дифф (+добавленные/-удалённые); автообновление таймером (`sub_auto_update` ≥ 30 минут, только группы без skip_auto_update, сериально).

**Качество**: код рабочий и обкатанный, но: монолит с UI-вызовами (MessageBox из парсера, `MW_show_log`) — не переносится в headless без рефакторинга; исключения YAML глотаются в MessageBox; есть мелкие баги (дубль строки `utlsFingerprint` в vmess-ветке, lines 345–346); тестов нет; поддержка only ClashMeta-подмножества.

---

## 5. Подсистема обновления (ядро + приложение)

Слои:
1. **RPC `Update`** (`go/grpc_server/update.go`): Check — GitHub API `repos/anatolijlaptev1991-ctrl/nekoray/releases` (клиент через текущий прокси-инстанс, таймаут 10 с); логика: если **любой** asset **любого** релиза содержит текущую версию в имени → «нет обновлений»; иначе первый asset с подстрокой платформы (`windows64` / `linux64` / `macos-<arch>`), pre-release фильтруется по флагу. Download — GET сохранённого URL → файл `../nekoray.zip` (cwd ядра = `config/`, т.е. в корень приложения). URL хранится в **глобальной переменной** `update_download_url` без блокировки.
2. **updater/launcher** (`go/cmd/updater`): Windows — `updater.exe` копирует себя в `updater.old`, стартует его, тот спит 1 с, распаковывает zip в `./nekoray_update`, перемещает `nekoray_update/nekoray/*` поверх `./`, удаляет старые `*.dll`/`*.dmp`, стартует `nekobox.exe`. Linux — `updater` (симлинк на `launcher`) распаковывает tar.gz/zip и стартует nekobox или `Launcher()` (настройка `LD_LIBRARY_PATH`/`QT_PLUGIN_PATH`, `NKR_FROM_LAUNCHER=1`). Ошибки — Win32 MessageBox (`msgbox*.go`). **Поправка 2026-10 — защита от zip-slip отсутствует:** используется `codeclysm/extract` v2.2.0 (2019), где `path = filepath.Join(location, path)` без проверки; `safeJoin` появился только в v3.1.0 (см. BUGS.md LNB-02, сырой отчёт 03 §1).
3. **GUI-флоу** (`ui/mainwindow_grpc.cpp CheckUpdate`): RPC Check → диалог (Update / Open in browser / Close; updater запрещён при `-appdata`) → RPC Download → перезапуск с `exit_reason=1` → `startDetached("./updater")`.

**Подписи/контрольные суммы отсутствуют полностью** — ни в RPC-проверке, ни в updater (единственная защита — TLS GitHub и то, что download идёт через прокси-инстанс). Для LAVRay: канал (GitHub releases) и схема «zip поверх установки» переиспользуемы по идее, но обязательно добавить манифест с sha256 + подпись (minisign/ed25519) и проверку перед применением; логику выбора asset и версию-сравнение переписать (сейчас — эвристика на подстроках).

---

## 6. Happ-декриптор (`go/cmd/nekobox_core/happ/`)

Чистый пакет `happdecrypt` (~300 строк + ~260 строк тестов):
- Префиксы `happ://crypt5|crypt4|crypt3|crypt2|crypt` (и отсутствующий/неизвестный → crypt5, как в эталоне).
- RSA PKCS#1 v1.5 (ключи PKCS#8, embedded `assets/native_keys.json` — 4 ключа) для crypt–crypt4; crypt5: блочные перестановки `m4831f`/`inverseM4831f`/`m4842j`/`permute4` (блоки 6/6/2/4), маркер = первые 4 + последние 4 байта → выбор ключа из 36 (`assets/crypt5_final_keys.json`), nonce 12 байт, длина сегмента ведущими цифрами, RSA-обёрнутый ChaCha20-ключ; **salted-вариант** (новые релизы): 2 skip-байта + 8-байтовая соль, ключ XOR-ится с солью; пробуются оба лейаута.
- b64-декодер с автопаддингом, std+urlsafe. `sync.Once` на загрузку ключей, `Decrypt` stateless. **Поправка 2026-10 — паника на коротком теле:** `body[14:22]` (salted-ветвь) паникует при `len(body)` 13–21 байт, включая fallback-проход; негативные тесты эту длину не покрывали — `happdecrypt.go:250-269`, BUGS.md LNB-13. В долгоживущем сайдкаре LAVRay обязателен `recover` и явная проверка длины.
- **Тесты**: 38 векторов, сверенных с эталонным бинарником `happ-decrypt-universal`, синтетика для всех 4 RSA + всех 36 crypt5 ключей (+ salted), round-trip перестановок, негативные кейсы, регистр префикса. `go vet` чистый. (Поправка 2026-10: один класс входов — тело 13–21 байт — не покрыт и паникует, см. выше.)
- CLI: `nekobox_core happ-decrypt <link>` → одна строка JSON `{ok, result|error}`, exit 0/1; вызывается Qt GUI отдельным короткоживущим процессом (`main/HappLink.cpp`, таймауты 3/10 с, kill при зависании).

Вывод: **эталонный кусок кода в проекте** — брать в LAVRay как есть (чистый Go, зависимости только `golang.org/x/crypto`).

---

## 7. Качество кода и найденные проблемы

### 7.0 Конфигурация рабочего пространства (критично для сборки)
- ~~Локальная копия `D:/ZCode/nekobox/sing-box` стоит на upstream-коммите `b47a09e` («Bump version», testing-ветка) — neko-слой (boxmain/boxapi/box_neko.go) в рабочем дереве отсутствует~~. **Устарело (2026-10, аудит):** рабочая копия теперь на HEAD `628a9ed` (1.14.1-neko.1), neko-слой (`box_neko.go`, `boxapi/`) присутствует; исходная проблема решена. Сборку `nekobox_core` перед проверкой всё равно начинать с `git -C sing-box checkout 628a9ed70b…`.
- Штамп версии в `constant/version.go` коммита — `1.14.1-neko.1`; строка nekoray — `nekoray-4.0.1-happ.4-sb114`.

### 7.1 Go-ядро
1. **Гонки на глобалах** (`grpc_box.go`): `instance`, `instance_cancel`, `statsService` без мьютекса; `Start` не защищён от параллельного `Test(UrlTest)` по бегущему инстансу. В текущем сценарии один GUI-клиент, но для LAVRay (много клиентов REST/WS) — обязательно обернуть в менеджер с мьютексом.
2. **`Exit` без graceful shutdown**: `os.Exit(0)` без `instance.Close()` — на Windows возможны «зависшие» TUN-интерфейсы/маршруты при выходе через Exit при запущенном профиле (UI обычно сначала вызывает Stop, но Exit при крэше GUI этого не делает).
3. **`update.go`**: сравнение версий подстроками (`strings.Contains(asset.Name, nowVer)`) — «4.0» совпадёт с «4.0.1» и т.п.; берётся первый подходящий asset, а не максимальная версия; глобальный `update_download_url` без синхронизации (Check и Download могут пересечься); хардкод репозитория; отсутствие checksum/подписей; путь `../nekoray.zip` — неявная зависимость от cwd.
4. **`fulltest.go`**: утечки горутин при таймаутах — sender пишет в небуферизованный `result` после ухода читателя из `select` (UDP-тест, speed-тест) → горутина висит вечно (соединение живёт, пока не закроется само); `io.Copy` с проигнорированной ошибкой; `getBetweenStr` с ручным слайсингом байтов; хардкод 8.8.8.8:53 для UDP-теста; двойной `Close` body (defer + явный) — безопасно, но грязно.
5. **`grpc.go`**: `flag.CommandLine.Parse(os.Args[2:])` — нет обработки ошибок флагов/`-h`; токен по stdin — работает, но требует, чтобы родитель писал stdin (для headless нужен флаг); `log.Fatalln` в нянечке родителя — не Headless-совместимо.
6. **Мёртвое поле** `LoadConfigReq.enable_nekoray_connections` — ядром не читается; `ListConnections` — заглушка → UI-фича connection_statistics не работает.
7. **Два Go-модуля** с огромным разрывом версий (`grpc_server`: go 1.19, grpc v1.49 vs `nekobox_core`: go 1.25.5, grpc v1.79 в графе) — пережиток; для LAVRay слить в один модуль.
8. Тестов в Go-ядре нет нигде, кроме `happ/`.

### 7.2 C++ сторона (что уйдёт вместе с Qt)
1. `JsonStore`-рефлексия на `void*` — хрупко; `integer64` читается через `toDouble()`; нет версионирования схемы.
2. `Database.cpp`: сохранение не транзакционно (крах между удалением/записью теряет профиль); `-flag_reorder` удаляет все файлы профилей перед пересозданием.
3. `rpc/gRPC.cpp`: самописный gRPC-клиент поверх QNetworkAccessManager (HTTP/2 direct, ручная 5-байтовая рамка, блокирующий QEventLoop, QMutex как семафор в `Call`); для Test создаётся новый канал+поток+NAM на каждый вызов.
4. `mainwindow_grpc.cpp`: `QMutex` вместо семафора для синхронизации stop (`lock/unlock` handshake); семафоры `mu_starting/mu_stopping/sem_stopped` — неочевидная машина состояний; спидтест с разделяемым `profiles_test` под мьютексом.
5. `GroupUpdater.cpp`: UI-зацепленность (MessageBox/MW_show_log из логики парсинга), дубль строки utlsFingerprint, отсутствие тестов.
6. `ExternalProcess.cpp` — автоперезапуск ядра с rate-limit — модель хорошая, реализация привязана к QProcess.

---

## 8. Оценка переиспользования для LAVRay (по компонентам)

| Компонент | Где сейчас | Вердикт | Обоснование |
|---|---|---|---|
| Форк sing-box 1.14.1-neko.1 (boxmain.Create, neko_run, box_neko) | `sing-box@628a9ed` | **Брать как есть** | Тонкий, актуальный слой; `Create` с реестровым контекстом — правильный механизм 1.14; обновлять только вслед за upstream |
| boxapi (DialContext/DialUDP/CreateProxyHttpClient/Stats) | `sing-box@628a9ed/boxapi` | **Брать как есть** | Стабильные обёртки над стабильным API |
| happ-декриптор + тесты | `go/cmd/nekobox_core/happ` | **Брать как есть** | Чистый пакет, 38 проверенных векторов, зависимость только x/crypto |
| libcore.proto (контракты LoadConfig/Test/Stats) | `go/grpc_server/gen` | **Адаптировать** | Схемы хорошие; поле `enable_nekoray_connections` удалить, `ListConnections` либо реализовать (clash-api/v2ray-api connections), либо убрать; расширить сервисами профилей/подписок/логов |
| gRPC-сервер RunCore (флаги, токен, нянька родителя) | `go/grpc_server/grpc.go` | **Переписать** | Под headless: `--headless`, конфиг из файла, сигналы, graceful shutdown, опциональная нянька; каркас (listen 127.0.0.1, токен) оставить |
| Аутентификация (nekoray_auth-заголовок) | `go/grpc_server/auth` | **Адаптировать** | Схема токена ок; перевести на interceptor ConnectRPC/Bearer; для LAN (OpenWrt) добавить bind-адрес в конфиг |
| RPC Start/Stop/QueryStats | `go/cmd/nekobox_core/grpc_box.go` | **Адаптировать** | Логика верна; добавить мьютекс/менеджер инстансов, graceful Close в Exit, семантику статистики (diff в ядре вместо UI) |
| FullTest (DoFullTest) + speedtest | `go/grpc_server/fulltest.go` + libneko | **Переписать** | Утечки горутин, строковый отчёт; сделать структурированный результат; context-timeout повсюду |
| Update RPC | `go/grpc_server/update.go` | **Переписать** | Эвристики версий, нет подписей/checksum; нужны каналы (stable/beta), манифест, верификация |
| updater/launcher | `go/cmd/updater` | **Переписать** | Идея самозамены ок, но: нет верификации, Win32-специфика, сообщение об ошибке MessageBox; для LAVRay — встройка в приложение/ядро + подписанные пакеты |
| Конфигбилдер | `db/ConfigBuilder.cpp` | **Переписать (портировать на Go в ядро)** | Обязан жить в ядре для headless. Поправка 2026-10: переносящееся «ядро порта» — не «~850+240 строк», а 4 444 строки C++ (билдер+модель+ссылки+подписки+хранилище+DataStore/Routing; таблица в §11.1); перенос 1:1 закрепил бы дефекты (hy2 `hop_ports` вместо `server_ports`, отсутствие `cache_file` и др.); сохранить MergeJson-семантику `+`-ключей и теги proxy/g-<id> |
| Модель профилей (beans, stream settings, сериализация) | `fmt/*`, `db/ProxyEntity.hpp` | **Переписать на Go** | Структуры → Go-структуры с json-тегами (совместимость формата файлов profiles/<id>.json для миграции); TryParseLink/ToShareLink → Go |
| Хранилище (profiles/groups/routes JSON-файлы) | `db/Database.cpp` | **Переписать на Go** | Формат файлов сохранить (миграция NekoBox→LAVRay), механику — Go (атомарная запись tmp+rename, блокировки) |
| Парсеры подписок (base64, ссылки, Clash YAML) + GroupUpdater-флоу | `sub/GroupUpdater.cpp`, `fmt/Link2Bean.cpp` | **Переписать на Go** | yaml.v3; отделить парсинг от UI; сохранить семантику диффа/порядка/Subscription-UserInfo |
| Транспорт GUI↔ядро (gRPC over QNAM) | `rpc/gRPC.cpp` | **Не переносить** | Заменить ConnectRPC/REST+WS-клиентом на TS (Tauri UI) и Go (headless-клиенты) |
| Lifecycle GUI (CoreProcess, neko_start/stop, TrafficLooper) | `ui/mainwindow_grpc.cpp`, `sys/ExternalProcess.cpp` | **Переписать в ядро** | Рестарт-политика, «remember profile», авто-старт при поднятии ядра — переносятся в headless-менеджер ядра; UI станет тонким |
| Настройки/DataStore/Routing | `main/NekoGui_DataStore.hpp` | **Адаптировать** | Список ~70 настроек — реестр требований к конфигу LAVRay; формат поменять (единый YAML/JSON с версионированием), совместимость через импортёр |

Итог по объёму Go-ядра LAVRay (поверх nekobox_core): портируются конфигбилдер + модель + парсеры ≈ **3–6 тыс. строк Go** (поправка 2026-10: по фактическому подсчёту — ядро порта 4 444 строки C++, в Go это 5–7 тыс. строк без тестов; см. §11.1), новое (headless-менеджер, HTTP/WS-сервер, ConnectRPC-слой, подписи/обновления) ≈ **3–5 тыс. строк**, плюс тесты. В поправку не входят и обязательны: oracle/golden-инфраструктура (§11), импортёр NekoBox, санитайзер логов, SSRF-безопасный fetcher подписок, супервизор ядра.

---

## 9. Что нужно добавить для LAVRay — оценка объёма работ

### 9.1 Встроенный HTTP-сервер (веб-UI + REST/WS)
База: стандартный `net/http` (уже в графе зависимостей; chi — тоже, тянет sing-box).
- Статика веб-UI: `go:embed dist` + `http.FileServer` — тривиально (~50 строк).
- REST `/api/v1/*`: профили/группы CRUD, старт/стоп, спидтест, статистика, подписки (обновить/добавить), настройки, экспорт конфига. По сути — экспонирование того, что сейчас делают C++ `mainwindow_grpc.cpp` + `db/` + `sub/`, поверх портированных Go-модулей. ~1.5–3 тыс. строк (хендлеры+валидация+сериализация).
- WS (`/api/v1/ws` или SSE): события логов (сейчас — stdout-пайп; заменить на подписку на лог-фабрику sing-box через `SetLogWritter` → мультиплексор), статистики (push вместо поллинга QueryStats), соединений (реализовать через clash-api/v2ray-api connection tracker — заодно закрывает заглушку ListConnections). Hub+broadcast ~300–500 строк.
- Безопасность (поправка 2026-10, сырой отчёт 03 §4 — план этого пункта устарел): десктоп — **без TCP вообще** (UI ↔ Rust через IPC Tauri; Rust ↔ ядро через unix-socket/named pipe с проверкой владельца); веб-режим — вход по паролю (Argon2id), сессия `HttpOnly; SameSite=Strict; Secure` + CSRF-токен, привязка к адресу LAN (не `0.0.0.0`), HTTPS; API принимает сущности (профиль, маршрут), а не сырой `core_config`; `Test` — только по валидированным целям.
- OpenWrt: сборка уже `CGO_ENABLED=0` — кросс-компиляция тривиальна; добавить procd/init.d-скрипт, uci-конфиг (~200 строк шелла/uci).

### 9.2 Headless-режим
Флаги `--headless --config <dir>`: без няньки родителя (или `--parent-watch`), токен из конфига/файла вместо stdin, обработка SIGTERM/SIGINT → graceful Stop+Close, автозапуск последнего профиля, автоперезапуск инстанса при ошибке старта (политика из CoreProcess), автоперезапуск подписок по таймеру (перенос UI_update_all_groups). ~300–600 строк поверх портированного профиль-стора.

### 9.3 ConnectRPC вместо gRPC
Текущий контракт крошечный (1 сервис, 7 методов, ~15 сообщений) — миграция механическая: тот же `libcore.proto`, генерация `connectrpc.com/connect`, хендлеры с теми же сигнатурами, интерцептор-аутентификация вместо grpc-middleware. Выигрыш: обычный HTTP (браузер, fetch из Tauri/веб-UI, curl для отладки), три протокола (proto/grpc-web/json) на одном маршруте, меньше зависимостей. ~1–2 дня работы, риск низкий. Рекомендация: ConnectRPC как основной API, REST-слой из 9.1 — тонкие JSON-обёртки над теми же сервисами.

### 9.4 Прочее
- Портирование конфигбилдера/модели/парсеров — см. §8 (крупнейший блок, ~3–6 тыс. строк).
- Обновления с подписями (ed25519/minisign-манифест, sha256 по каждому asset, каналы stable/pre-release) — ~500–800 строк.
- Тесты: формат-фикстуры конфигбилдера (снапшоты JSON по матрице профилей), парсеры (векторы ссылок/YAML), happ уже покрыт.

Суммарная оценка Go-части LAVRay: **6–12 тыс. строк нового/портированного кода** сверх nekobox_core+sing-box, календарно ~4–8 недель на одного Go-разработчика до feature-complete headless-ядра с веб-UI API. (Поправка 2026-10: оценка оптимистична — с учётом фактических 4 444 строк порта, oracle-тестов, импортёра NekoBox, санитайзера логов, SSRF-безопасного fetcher и супервизора срок и объём выше; см. §11.1.)

---

## 10. Приложение: карта ключевых файлов

| Файл | Роль |
|---|---|
| `nekoray/go/cmd/nekobox_core/main.go` | точка входа: happ-decrypt CLI / nekobox-режим / sing-box CLI |
| `nekoray/go/cmd/nekobox_core/core_box.go` | setupCore: лог, диал-функции, HTTP-клиент через инстанс |
| `nekoray/go/cmd/nekobox_core/grpc_box.go` | Start/Stop/Test/QueryStats/ListConnections |
| `nekoray/go/cmd/nekobox_core/happ/*` | happ-декриптор + тесты (38 векторов) |
| `nekoray/go/grpc_server/grpc.go` | RunCore: флаги, токен, нянька родителя, listen |
| `nekoray/go/grpc_server/auth/auth.go` | токен-аутентификация (metadata nekoray_auth) |
| `nekoray/go/grpc_server/update.go` | Update RPC (GitHub releases) |
| `nekoray/go/grpc_server/fulltest.go` | FullTest (латентность/UDP/скорость/IP) |
| `nekoray/go/grpc_server/gen/libcore.proto` | контракт API |
| `nekoray/go/cmd/updater/*` | updater/launcher самозамены |
| `nekoray/db/ConfigBuilder.cpp` | генератор конфига sing-box (формат 1.14) |
| `nekoray/db/Database.cpp` | ProfileManager, хранение profiles/groups |
| `nekoray/fmt/Bean2CoreObj_box.cpp`, `fmt/Link2Bean.cpp`, `fmt/Bean2Link.cpp` | bean → outbound JSON; ссылки → bean и обратно |
| `nekoray/sub/GroupUpdater.cpp` | подписки: happ-хук, base64, Clash YAML, ссылки, дифф-флоу |
| `nekoray/rpc/gRPC.cpp` | самописный gRPC-клиент (QNAM, HTTP/2) |
| `nekoray/ui/mainwindow_grpc.cpp` | жизненный цикл start/stop/test/update, TrafficLooper |
| `nekoray/sys/ExternalProcess.cpp` | CoreProcess: stdin-токен, детект запуска, автоперезапуск |
| `nekoray/libs/get_source.sh`, `libs/get_source_env.sh` | пины sing-box/libneko/net |
| `sing-box@628a9ed70b` | форк 1.14.1-neko.1: boxmain, neko_run.Create, box_neko, boxapi |

---

## 11. Golden-тесты паритета

Раздел добавлен аудитом 2026-10 (перенесён из сырого отчёта `docs/audit-2026-10/raw/02-core-data-code.md`, §2.1–§2.3). Это обязательная основа плана тестирования переноса C++ → Go (`docs/TEST-PLAN.md`).

### 11.1 Фактические размеры порта (`wc -l`, форк `caad794`)

| Блок | Файлы | LOC |
|---|---|---|
| Билдер | CB.cpp/hpp 905 + B2C 237 + Preset 18; минус VPN-функции CB:773-844 (72) | 1088 |
| Модель | AbstractBean 148 + 9 заголовков бинов 415 + includes 10 | 573 |
| Ссылки | L2B 296 + B2L 225 | 521 |
| Подписки | GU 720 + HTTPRequestHelper 116 + ProfileFilter 109 | 945 |
| Хранилище | Database 456 + Group/ProxyEntity/TrafficData 147 | 603 |
| JsonStore/DataStore/Routing | NekoGui.cpp 462 + ConfigItem 70 + DataStore.hpp 182 | 714 |
| **Итого ядро порта** | | **4444** |
| Внешние ядра (naive/custom) | Bean2External 265 | +265 |
| Утилиты (b64, SplitLines, ip, порт) | из 437 | ~+150 |

Итого ≈ 4,9 тыс. C++; в Go 5–7 тыс. без тестов. Не портируются: TrafficLooper 167, HappLink 76, rpc/gRPC 342, JsonStore-рефлексия ≈ 270, VPN-шаблон 72. Go-ядро сейчас: 728 строк без gen, happ 304 + 265 тестов.

### 11.2 Что golden-тесты обязаны зафиксировать

| Поведение | Где |
|---|---|
| MergeJson, применяется и к forTest/forExport | CB:32-69, 89, 363 |
| Цепочка: reverse списка, front_proxy в хвост, теги `proxy` / `c-0-<id>` / `g-<id>`, `detour`, mapping-inbound + route-правило для ext-ядра, chain-in-chain = ошибка | CB:101-135, 174-285 |
| mux только на exit-хопе, исключения grpc / http+tls / vless+flow, `multiplex_status` 0/1/2 | CB:327-360 |
| outbound `domain_strategy` на каждом outbound + `default_domain_resolver.strategy`; легаси `"AsIs"` из старых routes SB отвергает (option/types.go:98-111) | CB:349, 748-751; DataStore.hpp:27-28 |
| DNS: makeDnsServer (неизвестная схема → udp; голый IPv6 корёжится `lastIndexOf(':')`), порядок серверов и правил, `full:<server>` только для не-IP, predefined 32/33 и `.lan`, `use_dns_object` без валидации, `dns.strategy` только remote | CB:540-658, 374-376 |
| Порядок route.rules: sniff → custom(route)+custom(global) → hijack-dns → block-dom → proxy-dom → bypass-dom → block-ip → proxy-ip → bypass-ip → UDP/multicast-блок → TUN-правила; `final` не в test; `auto_detect_interface`=spmode_vpn, снимается в export | CB:663-756 |
| rule_set: тег `kind-name`, URL MetaCubeX, дедуп. Имена geo не lower-case, домены lower-case. Смешанный список = одно правило → нужен match-тест (SB route/rule/rule_item_rule_set.go:67-110), не только JSON-diff | CB:462-531 |
| Дельты forTest/forExport: нет inbounds, dns-remote, user-rules, final, clash_api, hijack | CB:396, 414, 450, 456, 601, 609, 628, 663, 731, 752, 761 |
| Stream/TLS: ws `?ed=` (дробь после `?ed=` → 0, ed молча теряется), `insecure`=allow_insecure‖skip_cert, short_id[0], reality→utls `random`, alpn без trim, packet_encoding только vmess/vless | B2C:13-78 |
| Протоколы: VLESS flow (`-udp443` chop, `none`→"", мутирует бин); SS `plugin_opts` при отсутствии `;` = имя плагина (Utils.hpp:50-53); socks auth только если оба поля; hy2 alpn=h3, `insecure` без skip_cert; TUIC uos vs relay_mode | B2C:90, 109-122, 157-163, 181-219 |
| **hy2 hop** эмитит `hop_ports` и int `hop_interval`; в SB поле `server_ports`, Duration-строка, формат `a:b`. Золотой эталон = намеренное отклонение | B2C:200-203; SB option/hysteria2.go:205-206, options.go:41, sing badoption/duration.go:20-30, sing-quic hysteria/client.go:115-121 |
| Share-links: Qt `FullyEncoded`; SS 3 формата + magic-placeholder для 2022, base64url с паддингом; vmess v2rayN (std-b64 JSON) vs «ducksoft» (fp из глобальных); hy2 `user:pass`; не экспортируются ed, packet_encoding, mux, uot, hopInterval | B2L:23, 76-100, 103-170, 205-216 |
| Парсинг: `GetQuery` = FullyDecoded → QUrlQuery (двойной decode, Utils.hpp:69); `peer` перекрывает sni; `allowInsecure` любое непустое; `replace()` подстрокой; `h2`→`http`; `\|`→`,`; fp из глобальных; default port: http=443, trojan security=tls, vless="", vmess-xray=tls; `+` не пробел в QUrlQuery [проверь] | L2B:27, 65-89, 199 |
| Base64 = строгий Qt515: один алфавит на вызов (std: GU:40, L2B:31,150; url: GU:70, L2B:9,123), `=` только в конце при len%4==0, пробелы/CRLF = ошибка, без `=` любая длина ок. MIME-wrapped подписка → построчный fallback даёт мусор | 3rdparty/base64.cpp:26-57 |
| Clash: детект подстрокой `proxies:`; ssr→ss; vless/trojan всегда tls; `h2`→`http` только в vmess; VLESS xudp по умолчанию; up/down `split(" ")[0].toInt()`; heartbeat ms; tuic `ip`; неизвестные типы молча skip; YAML-исключение рвёт импорт | GU:46, 223, 291, 296, 340, 372-374, 421-461 |
| Diff подписки: ключ = JSON бина без c_cfg/c_out + тип, **включая name**; off-by-one `deleted_index > 0` → первый совпавший профиль заменяется новым (теряет статистику); при 0 распарсенных профилей без sub_clear удаляются ВСЕ старые | ProfileFilter.cpp:5-9; GU:562-625 |
| Хранилище: пустые строки не пишутся при непустых дефолтах (SS aes-128-gcm, vmess auto, hy2 hop=10, TUIC bbr/native/10s); неверный тип молча игнорируется; неизвестный или битый профиль УДАЛЯЕТСЯ; `order` пуст = все, непуст = только перечисленные | NekoGui.cpp:76, 125-146; Database.cpp:47-55, 381-392 |

Четыре яруса тестов: паритет с oracle; `sing-box check` на каждом golden (ловит класс «hop_ports», где паритет закрепил бы баг); match-тесты route/DNS; фаззинг (happ, b64, ссылки, YAML — по BUGS §4.6).

### 11.3 Структура корпуса `testdata/`

```
testdata/oracle/            # генерирует C++-oracle @caad794, руками не править
  inputs/{links/<proto>/*.txt, subs/<case>/{body.*,headers.json}, native/<case>/{groups,profiles,routes_box}/}
  expected/{bean/*.json, config/<case>.{main,test,export}.json, sharelink/*.txt, subdiff/*.json}
testdata/matrix.yaml        # протокол × транспорт × security × mux × chain × routing × dns × tun
testdata/deviations.yaml    # осознанные отличия от oracle: причина + ссылка
testdata/fuzz/
```

Сравнение: канонизированный JSON, порядок ключей объектов не важен, порядок массивов важен. Oracle должен подменять `MkPort`, `GetRandomString`, id, ввод и заглушки MessageBox/MW_show_log. Сборку oracle не проверял; зависимости Qt Core/Network + yaml-cpp.
