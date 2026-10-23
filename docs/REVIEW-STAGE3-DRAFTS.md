# АДВЕРСАРИАЛЬНОЕ РЕВЬЮ stage3-drafts (LAVRay, L2) — 2026-10-23

Ревьюер: adversarial-агент L2. Объект: `stage3-drafts/` (proto, планы, CI, пресеты). Эталоны: REQUIREMENTS (281 FR), AUDIT (с поправками 2026-10), BUGS (LNB-01…36), UPDATE-SYSTEM v2.0, THREAT-MODEL, TEST-PLAN, OPENWRT-GATEWAY, fix-plan §4.

**Систематическая находка-предпосылка:** core-port-plan.md и proto/README.md написаны против старой редакции REQUIREMENTS («256 FR»), тогда как действующая — 281 FR (+раздел 21). Почти все серьёзные пропуски — неувиденная дельта +25 FR +12 LNB. Чинить первой.

## P0

1. **Подсистема обновлений реализует модель v1.0, а не UPDATE-SYSTEM v2.0 (TUF-lite).** Нет root.json (порог 2-из-3), timestamp.json (≤7 дней, анти-freeze), serial/expires/product в манифесте (→ downgrade-атака подписанной старой версией, LNB-11-класс), sources.json (URL-пиннинг в коде противоречит §1.6 «allowlist из подписанного sources.json»); запрет отдельной доставки ядра противоречит v2.0 §7 (minApp); нет last_checked_at. Правки: UpdateMetadata {root,timestamp,manifest,sources}; serial/expires/product/channel + last_checked_at; §W8 под v2.0; либо задокументировать откат от §7 как решение владельца.
2. **LNB-25 (подписка→RCE) не закрыт.** Импорт не зачищает c_cfg/c_out/core/cmd (ручное включение — с diff и подтверждением, FR-UI-257 MUST); MergeJson без allowlist (запрет experimental, log.output, чужих inbounds); портируемый 1:1 MergeJson сохраняет external_ui_download_url → zip-slip. Правки: import hardening (allow_custom_fields=false по умолчанию, preview с предупреждением), allowlist мержа, golden-вектор «подписка с c_cfg → поля отброшены».

## P1 (17)

3. Модель прав противоречит FR-UI-269/THREAT-MODEL/LNB-26/27: Windows — служба LAVRay + IPC-помощник (не runas себя); Linux — systemd AmbientCapabilities=CAP_NET_ADMIN (не file-caps на бинаре); убрать UAC-рестарт себя; источник — UPDATE-SYSTEM §6.
4. Нет DiagnosticsService для FR-UI-271/272/273 (MUST): CheckRoute(address,process?)→{rule,outbound,matched_list}, RunSelfCheck(kind[]) (8 проверок «Почему не работает?»), GetPublicIP(via), проверка утечек (туннель/прямой IP/DNS/IPv6).
5. FR-UI-262/263 не представимы: заголовки подписки (profile-update-interval, profile-title, profile-web-page-url, support-url, announce, строки #key: value, «Без лимита»/«Бессрочно») и per-sub настройки (interval, свой UA, заголовки, HTTP Basic, «последний рабочий») — расширить SubscriptionInfo и UpdateSubscriptionSettingsRequest; «последний рабочий источник» — поле Group.
6. FR-UI-258/LNB-29: защита от деструктивного обновления — confirm_destructive + PHASE_CONFIRM_REQUIRED с would_remove_count (0 профилей / >50 % удалений — не применять), RollbackSubscription(group_id) к снапшоту.
7. ConnectionService через clash-api заново открывает LNB-18.2 (CORS *, WS без Origin, токен в query): bind 127.0.0.1:random или unix-socket, CSPRNG-секрет в процессе, external_ui off; альтернатива v2ray-api без HTTP.
8. bind_address=0.0.0.0 на OpenWrt противоречит OPENWRT-GATEWAY §6 и THREAT-MODEL: конкретный LAN-адрес из UCI; отказ слушать 0.0.0.0 без явного флага.
9. WebSession против FR-UI-278: браузер — HttpOnly SameSite=Strict cookie + CSRF-токен (Bearer только headless); WS-аутентификация первым сообщением/cookie, никогда query; per-account backoff с блокировкой (IP-лимит за NAT бесполезен).
10. deep-link: только lavray://import?url=… с предпросмотром и rate-limit (FR-UI-280); убрать connect в v1 или явный диалог + пометка «отступление от THREAT-MODEL — решение владельца»; унифицировать имя параметра.
11. OpenWrt-шлюз без исполнителя: в план W7/W8 добавить internal/gateway/nft.go (fw4-include: таблица inet lavray, исключения, перехват DNS, IPv6-переключатель), DevicePolicy per-MAC в proto (List/Set), watchdog-откат; либо убрать GATEWAY_* из v1.
12. LNB-36/FR-UI-266: experimental.cache_file всегда включён; download_detour = активный прокси при поднятом туннеле (иначе direct); .srs встроенных пресетов в поставке с sha256; golden «старт с geosite-правилом без сети».
13. lav-cn.json: добавить geosite:category-ads-all в block_domain (PRESET-LAV-RU §3b — решение владельца), revision→2; geolocation-!cn — добавить или пометка в maintainer_notes.
14. Убрать SNIFFING_FOR_DESTINATION=2 (владелец оставил «Disable/для маршрута»; третий режим — DROP; G32 переопределить), SCHEMA sniffing_mode: 0|1.
15. Путь маршрутов NekoBox: config/routes_box/<name> (поправка аудита 2026-10), не routes/; tolerate routes/ для форков. Три места: core-port-plan §5.3, ImportNekoRayRoute, SCHEMA.md §6.
16. CI: `cache: pnpm` до установки pnpm — все 4 workflow упадут; ставить pnpm до setup-node.
17. OpenWrt CI: Go всегда linux-amd64 (хост), GOARCH — таргет; индекс фида собирать в feed/<arch>; убрать fallback ./scripts/.
18. macOS CI: `vars.HAVE_SIGNING` (не env); attach .app.tar.gz+.sig к релизу (иначе 404 в манифесте).
19. FR-UI-279/LNB-33: валидатор «inbound не loopback при пустой auth → INVALID_ARGUMENT»; семантика отключения mixed-слушателя в TUN.

## P2 (26) — кратко

20. «12 стримов» → 10. 21. «256 FR» → 281 (перегнать чек-лист grep). 22. NETWORK_QUIC + reality_spx (FR-UI-090a/267). 23. Порт ядра: -port 0 + чтение из LAVRAY_CORE_READY (LNB-20), убрать пробу-удержание. 24. Сироты внешних ядер: Pdeathsig/Job + четвёртая строка teardown «процессы ext:*». 25. DNS в teardown-таблице (resolv.conf/systemd-resolved == эталон). 26. Хвост: Stats/Connections без tail — оговорить; переподключаемый прогресс подписок (идемпотентность/ALREADY_EXISTS или событие). 27. WatchConnections: фильтр/страница/дельты + backpressure. 28. Приоритет TUN-bypass после process_rules; whitelist инвертирует только TUN. 29. sort_key каноничен, profile_order вычисляем. 30. SetDns = сахар над UpdatePreset (expected_revision). 31. testdata/deviations.yaml (hy2 server_ports/Duration LNB-35, base64-детектор, share-link FullyEncoded). 32. Подписки: split connect/overall-таймауты, 2 ретрая, sub_use_proxy default. 33. Права 0600/0700 на данные в W1. 34. TestLatency URL — валидатор как LNB-05. 35. ListSessions/RevokeSession; смена пароля → RevokeAllExceptCurrent; сетап-окно первого админа. 36-38. CI: linuxdeploy SHA256, digest-пин, permissions read, actions по SHA, contents:write сузить. 39. OpenWrt CI: feeds update/install; WEBUI_DIST → фиксированный каталог (embed compile-time); usign/apk-фид 25.12+; матрица 24.10/25.12. 40. SCHEMA ссылки §3.6→§3b. 41. GATEWAY_* вне платформы → INVALID_ARGUMENT в контракте. 42. domain_strategy: убрать или объявить пере-включение. 43. LogLine.source=shell: форвардить в ядро или убрать + клейка на UI. 44. --core-version генерировать из пина форка. 45. UpdateManifest: map<string,PresetRef> presets + GeoRef geo (rev, не semver).

## Пропущено полностью

FR-UI-271/272/273 (диагностика), FR-UI-275 kill switch, FR-UI-264/265 (свой UA + sing-box JSON подписки + HWID), FR-UI-267 доп-протоколы (отложено — но не записано в допущения), FR-UI-281 XHTTP (решение владельца — не surfaced), горячие клавиши (FR-UI-187/188), -appdata/каталог данных (FR-UI-247), crash-handler/минидампы (FR-UI-229), FR-UI-276 онбординг-предвыбор, недостающие 3 builtin-пресета, история трафика RPC (сводка по группе/подписке), TLS-бутстрап панели (self-signed + отпечаток), таблица миграции 56 ключей DataStore + extraCore.

## Вердикты по 6 решениям драфта

1. Конфигбилдер в ядре, Connect(profile_id, mode) — **ПРИНЯТЬ** (условия: закрыть P0-2, P1-12, P1-14, deviations.yaml).
2. Стримы вместо эвристик — **ПРИНЯТЬ С ПРАВКОЙ** (№26/27, WS-auth №9, клейка №43).
3. SQLite WAL/modernc/миграция — **ПРИНЯТЬ С ПРАВКОЙ** (0600 №33, порядок №29, routes_box №15).
4. Три времени жизни + teardown — **ПРИНЯТЬ С ПРАВКОЙ** (DNS №25, сироты №24, связка с помощником №3).
5. Внешние ядра от ядра — **ОСПОРИТЬ**: молчаливая отмена DROP-решений владельца (FR-UI-095/099/175/233-235, LNB-32, THREAT-MODEL). Рекомендация: v1 = naive + custom-external за явным флагом (решение владельца), hy2/tuic всегда внутренние (убрать force_external_core); при сохранении — обновить THREAT-MODEL/REQUIREMENTS + песочница + секреты ext-конфигов + обработка смерти родителя.
6. Пресеты versioned/platform-scoped — **ПРИНЯТЬ С ПРАВКОЙ** (№13, все пять builtin, приоритеты golden-тестом G28-G30, №40/15).

**Итог:** каркас зрелый, принимается с правками; обязательны до кода: P0-1 (регресс обновлений до v1.0), P0-2 (LNB-25), решение №5 — владельцу.
