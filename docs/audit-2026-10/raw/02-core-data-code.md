# Сырой отчёт 02. Данные и ядро NekoBox (feature/singbox-upgrade, caad794)

> Проверка-субагент аудита 2026-10-23 (статическое чтение кода). Основной отчёт — `docs/AUDIT-CLAUDE-2026-10.md`; при расхождении приоритет у него и у `docs/fix-plan/`.

Пути от `D:\ZCode\nekobox\nekoray\`. SB = `D:\ZCode\nekobox\sing-box` (HEAD 628a9ed = 1.14.1-neko.1). CB = `db/ConfigBuilder.cpp`, B2C = `fmt/Bean2CoreObj_box.cpp`, L2B/B2L = `fmt/Link2Bean.cpp` / `Bean2Link.cpp`, GU = `sub/GroupUpdater.cpp`, GB = `go/cmd/nekobox_core/grpc_box.go`, MWg = `ui/mainwindow_grpc.cpp`.

**Не проверено:** libneko нет в рабочей копии (speedtest, neko_log, neko_common); Go-тулчейна нет — ничего не собиралось; Qt не запускался — поведение QUrl/QUrlQuery/QJson выведено чтением [проверь]; `codeclysm/extract` не в кэше модулей; валидность конфигов оценена чтением `option/*` SB, а не `sing-box check`; UI-файлы — точечно.

## 1. Верификация AUDIT.md

| Утверждение | Вердикт | Доказательство | Поправка |
|---|---|---|---|
| 7 unary RPC, стримов нет | верно | libcore.proto:6-15 | В TestReq есть непрочитываемое `inbound`=4 и deprecated `full_nat`=11 (:44, :55); AUDIT их не называет. |
| Exit = os.Exit без Close | верно | grpc.go:29-35 | — |
| Start/Stop | верно, есть дефекты | GB:33-48, 78-86 | Повторный Start при живом инстансе: defer ставит `instance=nil` (:37) → осиротевший sing-box, Stop превращается в no-op. Close без таймаута, ошибка игнорируется. |
| Test (Tcp/Url/Full) | верно, есть дефект | GB:101-135 | `i, cancel, err :=` (:126) затеняет err → ошибка Create у FullTest теряется (Error="", Ms=0). `ctx` не используется (fulltest.go:39). |
| QueryStats со сбросом | верно | GB:144; SB boxapi/stats.go:19 | Трекер только для `proxy`, `bypass` (MWg:313-316); теги c-0-*/g-* всегда 0. |
| Нянька «os.Exit(0)» | неточно | grpc.go:48,52,58 | `log.Fatalln` → код 1. |
| Ядро пишет «listening» в stdout | [проверь] | grpc.go:99 (`log.Printf` → stderr); ExternalProcess.cpp:81 читает stdout | Зависит от libneko `neko_log.SetupLog` (core_box.go:21). |
| Рестарт ядра, rate-limit 10 с | верно | ExternalProcess.cpp:117-137 | CoreCrashed → `neko_stop(true)` (mainwindow.cpp:586-587; MWg:450), состояние сбрасывается. LNB-21 не подтверждается. |
| Update: «любой asset любого релиза содержит версию» | неточно | update.go:65-85, 54-63 | Решает первый совпавший при последовательном обходе. Платформы только windows/amd64, linux/amd64, darwin; OpenWrt/arm дают «Not official support». |
| Профиль: `traffic:{id,tag,uplink,downlink,last_update}` | неверно | TrafficData.hpp:15-17 | Персистятся только `dl`, `ul`. |
| Поля бинов (длинные имена) | неточно | AbstractBean.cpp:8-16; V2RayStreamSettings.hpp:33-49; fmt/*Bean.hpp | Ключи короткие: `_v,name,addr,port,c_cfg,c_out`. Stream: `net,sec,pac_enc,path,host,sni,alpn,cert,insecure,h_type,ed_name,ed_len,utls,pbk,sid,spx,mux_s`. ss: `method,pass,plugin,uot`; vmess: `id,aid,sec`; trojan/vless: `pass,flow`; socks: `v` (4/5/−80); custom: `core,cmd,cs,cs_suffix,mapping_port,socks_port`. |
| Дерево `routes/<name>` | неверно | NekoGui.hpp:20-21 | `config/routes_box/<name>`, без расширения. Остальное верно: main.cpp:113,181; Database.cpp:13,211,306. |
| «~70 настроек DataStore» | неточно | NekoGui.cpp:230-285 | 56 ключей, плюс вложенные `extraCore{core_map}` и `inbound_auth{user,pass}`. `old_share_link_format` есть в UI, но не персистится (DataStore.hpp:101). |
| MergeJson `+k/k+` = конкатенация | неточно | CB:32-69 | `+k`: src ПЕРЕД dst; `k+`: src ПОСЛЕ. Без маркера массив заменяется, объект мержится. `+k` с не-массивом остаётся литеральным ключом. |
| «Legacy-DNS убран полностью» | верно для CB, неверно для VPN-шаблона | CB:540-598; res/vpn/sing-box-vpn.json:95-96,134,150 | `dns`-outbound отвергается SB (option/outbound.go:55-58) → внешний TUN (CB:773-825) не стартует. |
| Happ «паники исключены», «брать как есть» | неверно | happdecrypt.go:250-269 | `body[14:22]` при len 13–21 (в т.ч. в fallback-проходе) → panic (LNB-13 верен). В долгоживущем сайдкаре нужен recover. |
| §7.0: SB на b47a09e без neko-слоя | устарело | SB HEAD 628a9ed; есть box_neko.go, boxapi/ | — |
| zip-slip «защищено» | [проверь] | updater.go:42,53 | Противоречит BUGS LNB-02; модуль не в кэше (сырой отчёт 03 подтвердил: v2.2.0 без защиты). |
| Билдер «~850+240 строк, 1:1» | неточно | CB 846 + B2C 237 | 1:1 перенесёт дефекты из §3 и §6; без Database/DataStore/Routing (≈1,3k) билдер не работает. |
| 3–6 тыс. строк; итого 6–12 тыс., 4–8 нед. | занижено | §2.1 | Порт = 5–7 тыс. Go без тестов. Не учтены oracle/golden, импортёр, санитайзер логов, SSRF-safe fetch, супервизор → срок оптимистичен [оценка]. |
| Карта файлов §10 | верно | — | Все пути существуют. |

Попутно по BUGS.md: LNB-04 — файл настроек `groups/nekobox.json`, не `nekoray.json` (main.cpp:181); LNB-15 — порт −1 для tuic/hy2 отсекается раньше (L2B:257), реальный дефект — ссылки без порта отвергаются, default 443 нет; U-12 — падение, а не «молча» (§3.8).

## 2. Порт

### 2.1 Размеры (`wc -l`)

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

### 2.2 Что golden-тесты обязаны зафиксировать

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

### 2.3 Корпус

```
testdata/oracle/            # генерит C++-oracle @caad794, руками не править
  inputs/{links/<proto>/*.txt, subs/<case>/{body.*,headers.json}, native/<case>/{groups,profiles,routes_box}/}
  expected/{bean/*.json, config/<case>.{main,test,export}.json, sharelink/*.txt, subdiff/*.json}
testdata/matrix.yaml        # протокол × транспорт × security × mux × chain × routing × dns × tun
testdata/deviations.yaml    # осознанные отличия от oracle: причина + ссылка
testdata/fuzz/
```

Сравнение: канонизированный JSON, порядок ключей объектов не важен, порядок массивов важен. Oracle должен подменять `MkPort`, `GetRandomString`, id, ввод и заглушки MessageBox/MW_show_log. Сборку oracle не проверял; зависимости Qt Core/Network + yaml-cpp.

### 2.4 Миграция NekoBox → LAVRay

**Файлы.** Каталог `<exe>/config`, при `-appdata`/`NKR_CPP_USE_APPDATA` — аргумент или AppConfigLocation, app "nekoray" (main.cpp:101-113). Пишет только GUI, ядро их не читает: `groups/nekobox.json` — DataStore; `groups/pm.json` — `{"groups":[gid]}`; `groups/<gid>.json` — группа (`lastup` в секундах); `profiles/<id>.json` — ProxyEntity; `routes_box/<name>` — Routing, 19 ключей, активный = `active_routing`; артефакты: `neko.log`, `temp/`, `vpn/*`, а также `sing-box-vpn.json` / `vpn-run-root.sh` с inbound-auth (CB:819-843).

**Формат.** Indented JSON, короткие ключи, пустые строки опущены, int64 через double, версий схемы нет (только `_v` бина и сентинел −114514). Запись неатомарная (NekoGui.cpp:192-196).

**Алгоритм импорта:** 1) только чтение, GUI закрыт (RunGuard), копия в `.bak`; 2) декодер как у FromJson: неверный тип игнорируется, неизвестные ключи и `type` сохраняются opaque, не удаляются; 3) конструкторные дефолты бинов; 4) санитайзинг: `AsIs`→"" в стратегиях; `dns_object` со старым форматом (`servers[].address`, `rcode://`, `independent_cache`) — мигратор на базе makeDnsServer либо флаг; 5) id сохранить или таблица соответствий для chain `list`, `front_proxy_id`, `remember_id`, `current_group`, `order`, `pm.json`; 6) таблица настроек keep / transform / drop (hk_*, theme, mw_size, splitter_state, column_width, spmode2 — drop); 7) перенести `dl/ul`, `yc` и `report` опционально; 8) секреты (url подписок, пароли) — в защищённое хранилище; 9) в LAVRay `schema_version` и цепочка миграций; импорт идемпотентен, с отчётом о потерях.

## 3. Пробелы относительно REQUIREMENTS/AUDIT

| # | Пробел | Файл:строка |
|---|---|---|
| 1 | Читается только `Subscription-UserInfo`. Нет profile-update-interval/title, content-disposition, support-url, announce, routing; HWID-заголовков нет [проверь, нужны ли RU-провайдерам]. Интервал и UA глобальные, per-group нет. `ParseSubInfo` требует `total=` (безлимит → пусто) | GU:548; NekoGui.cpp:299-309; ui/widget/GroupItem.cpp:19-24 |
| 2 | UA «Prefer ClashMeta Format» → панели отдают Clash YAML, поэтому Clash-парсер с багами (§2.2) — основной путь импорта | NekoGui.cpp:306 |
| 3 | Не поддержаны: JSON sing-box/Xray в теле подписки; `happ://` внутри тела и строк (только вход AsyncUpdate); `happ://add`, `happ://routing`; ssr/hysteria/wireguard/anytls/ssh; vless-xhttp. Схемы регистрозависимы, happ нет | GU:64-140, 473; HappLink.cpp:17 |
| 4 | В SB есть anytls, shadowtls, wireguard, ssh, hysteria, tor, selector, urltest; в моделях нет (обход только через CustomBean). Clash-типы wireguard/anytls/ssh/hysteria молча пропускаются | SB include/registry.go:83-102; GU:449-451 |
| 5 | Нет TLS fragment / record_fragment / ECH. Теряются `reality_spx` и 2+ short_id | SB option/tls.go:125-133; B2C:48-74 |
| 6 | hy2/tuic-ссылки: порт обязателен; нет pinSHA256, up/down, alpn, zero_rtt, heartbeat, диапазона в authority. Clash `up:"100mbps"` без пробела → 0 | L2B:254-295; GU:421 |
| 7 | MUST из REQUIREMENTS не влияют на конфиг: FR-UI-131/148 `domain_strategy`, `direct_dns_strategy`, `dns_final_out` (только UI). FR-UI-153: 32/33 = NIMLOC/SRV по IANA (HTTPS=65, SVCB=64), правило глушит SRV [проверь]. FR-UI-164 не персистится. FR-UI-246: `routes_box` | NekoGui.cpp:341-348; dialog_manage_routes.cpp:143-174; CB:629-633 |
| 8 | Нет `experimental.cache_file` (grep пуст): rule-set качается при каждом старте, сбой загрузки = отказ старта. AUDIT-SB п.3 («далее кэш») неверен | CB:758-770; SB route/rule/rule_set_remote.go:132-136 |
| 9 | FR-UI-234: в `process_name` кладутся полные пути, а SB сравнивает `filepath.Base` → авто-байпас ext-ядер не срабатывает [проверь, путь это или имя в extraCore] | CB:14-22, 721-726; SB route/rule/rule_item_process_name.go:28-32 |
| 10 | Дефолты Китай-ориентированы: direct_dns doh.pub, пресет geosite:cn / geoip:cn | DataStore.hpp:19; NekoGui.cpp:312-326 |
| 11 | `nekoray://` в теле подписки принимает любой JSON бина, включая `c_cfg`, `c_out`, `cmd` → нужен whitelist полей | GU:64-73 |

## 4. Скрытые «жемчужины»

| Что | Где | Зачем |
|---|---|---|
| Anti-loop: `full:<server>` каждого хопа → dns-direct + `domain_resolver` на DNS-серверах | CB:374-376, 596 | Без этого DNS сервера идёт через сам прокси. |
| MergeJson как контракт расширяемости | CB:32-69 | Совместимость пользовательских custom_config/custom_outbound. |
| Теги цепочки + mapping-inbound для ext-ядра в середине + ignoreConnTag | CB:174-285 | Статистика и chain через внешний процесс. |
| Нормализации импорта: FixEnt (SNI из host при IP), none/0/false, глобальный uTLS, reality→random, VLESS xudp, flow, `?ed=` в обе стороны | GU:22-36, 291, 302-304, 372; L2B:79-81; B2C:13-25, 65, 157 | Совместимость с реальными подписками. |
| Идентичность профиля для diff (после правки name и off-by-one) | ProfileFilter.cpp:5-9 | Сохраняет latency и трафик между обновлениями. |
| ResolveDomainToIP с переносом домена в SNI/Host | AbstractBean.cpp:44-78 | — |
| v2rayN-совместимость ввода: vmess JSON, ss legacy, socks b64, Xray-vmess | L2B:8-13, 31, 148-236 | — |
| Блок UDP 135/137/138/139/5353 и multicast | CB:687-699 | Защита от утечек. |
| Накопление дельт, дедуп тега за тик, rate; rate-limit рестарта ядра | TrafficLooper.cpp:17-77; ExternalProcess.cpp:117-137 | — |
| Happ: salted/legacy fallback, толерантный b64 | happdecrypt.go:105-117, 250-269 | — |
| makeDnsServer как основа мигратора legacy-DNS (LNB-08) | CB:540-598 | — |

## 5. Мёртвое / legacy (не портировать)

| Что | Доказательство |
|---|---|
| Внешний TUN: VPN-шаблон со снятым `dns`-outbound, `iptables` для «Tun2Socket», процессы `nekoray_core` | res/vpn/sing-box-vpn.json:95-96, 134, 150; vpn-run-root.sh:19-22; CB:773-844 |
| Внешние hy2/tuic (`forceExternal`); поля окон и MTU только для них | Bean2External.cpp:103-217; QUICBean.hpp:13, 22-24. Оставить naive/custom [проверь build-tags naive] |
| Поля RPC: `enable_nekoray_connections`, `ListConnections`, `TestReq.inbound` / `full_nat`; Update RPC и updater (заменить подписанным каналом) | proto:27, 44, 55; GB:150-155 |
| Роутинг-поля без эффекта; SniffingMode FOR_DESTINATION ≡ FOR_ROUTING | NekoGui.cpp:341-348; CB:734 |
| Остатки V2Ray/Xray: `DomainMatcher`, `CoreType::V2RAY // DO NOT USE`; ветка `quic` в mux без quic-транспорта; комментарии kcp/quic; TODO kcp/quic в vmess | Const.hpp:5-11, 20; CB:332; V2RayStreamSettings.hpp:14; L2B:176 |
| `chainId` и `globalProfiles` (всегда 0; `continue` пропускает detour) | CB:138, 213-217, 431 |
| Deprecated-поля, которые билдер всё ещё пишет: outbound `domain_strategy`, `endpoint_independent_nat` (no-op), `download_detour` (1.14→1.16) | CB:349, 420, 475; SB option/tun.go:70-71, experimental/deprecated/constants.go:82-89 |
| Qt-слой: JsonStore-рефлексия, самописный h2c-клиент, Reset-поллинг, argv для happ | NekoGui.cpp:21-221; rpc/gRPC.cpp; HappLink.cpp:30 |

## 6. Риски порта и сайдкара

| Риск | Основание |
|---|---|
| **Владение состоянием.** GUI сегодня SSOT, ядро stateless. После порта БД, подписки и профили живут в ядре, а `profiles` (std::map) и Database без локов (Database.cpp:261-282). Нужен актор или RW-lock. Запись `dl/ul` только при stop (MWg:428-436): крах = потеря счётчиков → периодические чекпойнты | Database.cpp; MWg:428-436 |
| **Паники убивают сайдкар.** gRPC без recovery; уже есть panic в `getBetweenStr` (пустое тело трейса, len<3) и в happ-salt; `log.Fatalln` в няньке | grpc.go:48-58, 91-94; fulltest.go:36; happdecrypt.go:259 |
| **Ошибки и отмена.** Ошибки in-band строками; затенённый err; `Create` без ctx; DoFullTest игнорирует ctx; «Stop testing» убивает потоки GUI, а ядро продолжает. Утечки горутин и инстансов (unbuffered `result` после timeout, гонка `bodyClose`) | GB:126; neko_run.go:15; fulltest.go:58-90, 123-157; MWg:74-81 |
| **Старт зависит от сети** (rule-set без кэша) и без дедлайна на клиенте (LNB-06) | rule_set_remote.go:132-136 |
| **Статистика:** `Reset_:true` (single-consumer), 4 унарных RPC/с на 2 тега под `loop_mutex`, который ждёт Stop. Нагрузка ничтожна; проблема в семантике. Нужен серверный сэмплер с монотонным временем и broadcast снимков. Диапазон 500–5000 мс | boxapi/stats.go:19; TrafficLooper.cpp:26-27, 72, 83, 106-116 |
| **Логи:** сегодня pipe + троттлинг на стороне GUI (max_log_line/с, сброс раз в секунду); без него WS-поток захлебнётся на info-уровне. Нужны батчинг, ring, счётчик drop, redaction (LNB-01). Вместо reflect-хака по полю `writer` (box_neko.go:14-19; применяется ПОСЛЕ Start, стартовые логи мимо) использовать `Subscribe()` | ExternalProcess.cpp:27, 93; mainwindow.cpp:430-432; SB log/observable.go:141 |
| **Крах и восстановление:** Exit без Close (grpc.go:33) → висящие TUN/маршруты, особенно Linux auto_route/redirect [проверь]. Нужен cleanup при старте и FSM супервизора: нянька `parent.Wait()` ломается в headless, порт через MkPort TOCTOU (LNB-20) | grpc.go:33, 45-62 |
| **Билдер нечист:** случайные порты, запись temp-файлов, мутация `ent->traffic_data` и глобального `need_keep_vpn_off` даже в test-сборках. В Go — чистая функция с инъекцией аллокатора портов и side-effects в результате | CB:142-144, 254-263, 266, 323-325; Bean2External.cpp:9-20 |
| **Дрейф sing-box:** по минорному релизу ломаются поля. Deprecated-менеджер в embedded `Create` не установлен (стоит только в CLI), поэтому предупреждения невидимы, а экспортированный конфиг с непустой стратегией на CLI даёт Fatal (stderr.go:31-45; Fatal → os.Exit, log/observable.go:156-157). Строить через типизированные `option.Options` и держать `check` в CI | SB cmd/sing-box/cmd.go:73; neko_run.go; dialer.go:94, 133 |
| **Qt-паритет:** QUrl tolerant, FullyDecoded + двойной decode, строгий b64, сортировка ключей QJson — отличаются от stdlib Go, нужны самописные хелперы и oracle | §2.2 |
| **Персистентность:** неатомарная запись, удаление неизвестных типов, сотни файлов. Переход на единую БД требует миграции и бэкапа | NekoGui.cpp:192-196; Database.cpp:47-55 |
| **Безопасность fetcher:** SSRF, `file://`, нет лимита размера; `sub_use_proxy` через mixed-inbound GUI (HTTPRequestHelper.cpp:13-48, 18-31). В сайдкаре ходить через инстанс (`CreateProxyHttpClient` имеет 3 с header-timeout, boxapi/go_http.go:11-13) | BUGS LNB-05/12 подтверждены |
