# 05. Документы проекта (задачи C1–C10)

Источники: отчёт, разделы 2 и 5; сырые отчёты `docs/audit-2026-10/raw/01–04`. Правило для всех задач: факты переносить с указанием `файл:строка` из сырых отчётов; утверждения без проверки помечать `[проверь]`; ничего не удалять из истории документов — устаревшее помечать «устарело (2026-10, аудит)» с пояснением.

---

## C1. `docs/REQUIREMENTS.md`

1. **Добавить раздел «21. Дополнения по аудиту 2026-10»** с новыми требованиями. Номера продолжают сквозную нумерацию: FR-UI-257 и далее. Каждое требование — строка таблицы «ID | Название | Поведение | Источник | Приоритет»:

   | ID | Название | Поведение (кратко) | Источник | Приоритет |
   |---|---|---|---|---|
   | FR-UI-257 | Безопасный импорт профиля | Профили из подписок и ссылок не принимают поля `c_cfg`, `c_out`, `core`, `cmd`; ручное включение — с показом diff и подтверждением | `sub/GroupUpdater.cpp`:61-73; `db/ConfigBuilder.cpp`:32-70 | MUST |
   | FR-UI-258 | Обновление подписки без потерь | Разбор в промежуточной копии; 0 серверов или удаление > 50 % — не применять без подтверждения; снапшот и «Откатить подписку» | `sub/GroupUpdater.cpp`:566-624 | MUST |
   | FR-UI-259 | Снимок и восстановление прокси ОС | Перед включением системного прокси сохранять прежние настройки (включая PAC/WPAD) и восстанавливать их при выключении и после краша | `3rdparty/qv2ray/v2/components/proxy/QvProxyConfigurator.cpp`:152, 186-189 | MUST |
   | FR-UI-260 | Атомарное хранение | Запись через временный файл, fsync и rename; резервная копия; битый файл — понятная ошибка, не тихий сброс | `main/NekoGui.cpp`:172-198 | MUST |
   | FR-UI-261 | Конечный автомат подключения | Состояния Idle, Starting, Running, Stopping, Failed, RateLimited; переходы и тексты состояний | `ui/mainwindow_grpc.cpp`:351-386 | MUST |
   | FR-UI-262 | Заголовки подписки | `subscription-userinfo`, `profile-update-interval`, `profile-title` (`base64:`), `content-disposition`, `profile-web-page-url`, `support-url`, `announce`, `routing`, строки `#key: value` в теле; «Без лимита», «Бессрочно» | `sub/GroupUpdater.cpp`:548; `ui/widget/GroupItem.cpp`:19-39 | MUST |
   | FR-UI-263 | Настройки на подписку | Интервал, User-Agent (пресеты + свой), свои заголовки, HTTP Basic, обновление через туннель, «последний рабочий» при сбое | `main/NekoGui.cpp`:299-309 | MUST |
   | FR-UI-264 | Свой User-Agent и согласование формата | UA `LAVRay/<версия>`; автопроба формата sing-box JSON; регистрация UA в панелях Marzban, Remnawave, PasarGuard | сырой отчёт 04 | SHOULD |
   | FR-UI-265 | HWID по согласию | Заголовки `x-hwid`, `x-device-os`, `x-ver-os`, `x-device-model` — только после явного включения; идентификатор случайный на установку | сырой отчёт 04 | SHOULD |
   | FR-UI-266 | Кэш rule-set и встроенные наборы | `experimental.cache_file` включён; наборы пресетов в поставке; старт без сети | `db/ConfigBuilder.cpp`:758-770 | MUST |
   | FR-UI-267 | Протоколы ядра | AnyTLS, ShadowTLS, WireGuard, SSH, Hysteria v1 — модели, ссылки, Clash-импорт, редактор; TLS fragment, ECH; `reality_spx`, несколько `short_id` | `sing-box/include/registry.go`:83-102 | SHOULD |
   | FR-UI-268 | Port hopping Hysteria2 | Генерация `server_ports` (`a:b`) и `hop_interval` строкой длительности; golden-тест с `sing-box check` | `fmt/Bean2CoreObj_box.cpp`:200-203 | MUST |
   | FR-UI-269 | Привилегированный помощник | Служба Windows / systemd-unit / SMAppService; принимает только валидированный конфиг по аутентифицированному IPC; UI и парсеры без прав | `ui/mainwindow.cpp`:697-710, 1790-1813 | MUST |
   | FR-UI-270 | Страж восстановления | После краша ядра или UI при следующем старте снимает TUN, маршруты, системный прокси и DNS | сырой отчёт 04 (уроки Verge Rev, Throne) | MUST |
   | FR-UI-271 | Проверка маршрута | «Куда пойдёт адрес/приложение»: сработавшее правило и исход | отчёт 5.3 | MUST |
   | FR-UI-272 | Диагностика «Почему не работает?» | 8 проверок (ядро, сервер, DNS, прокси/TUN, часы, подписка, порт, IPv6) с исправлениями | отчёт 5.3 | MUST |
   | FR-UI-273 | Проверка утечек | IP через туннель, прямой IP, DNS, IPv6 | отчёт 5.3 | MUST |
   | FR-UI-274 | Соединения | Список активных соединений с правилом и процессом; закрыть, создать правило | FR-UI-213 (в форке заглушка) | MUST |
   | FR-UI-275 | Kill switch | В TUN при падении туннеля трафик блокируется; выключено по умолчанию | отчёт 5.3 | SHOULD |
   | FR-UI-276 | Региональные пресеты | RU, CN, Глобальный; предвыбор по языку и часовому поясу | отчёт 3.6 | MUST |
   | FR-UI-277 | Перенос из NekoBox | Импорт `config/groups/*.json`, `profiles/*.json`, `routes_box/*` с отчётом о потерях; идемпотентно | сырой отчёт 02, §2.4 | MUST |
   | FR-UI-278 | Веб-панель: вход | Пароль (Argon2id), сессия `HttpOnly; SameSite=Strict; Secure`, CSRF-токен, лимит попыток, выход | сырой отчёт 03, §4 | MUST |
   | FR-UI-279 | Локальный прокси без открытого доступа | Случайный или заданный порт, пароль обязателен при доступе из LAN; в режиме «только TUN» loopback-слушатель mixed остаётся (паритет с NekoBox, решение владельца 2026-10-29), наружу — только с авторизацией | сырой отчёт 04 (уязвимость апреля 2026) | MUST |
   | FR-UI-280 | Deep link импорта | Только `lavray://import?url=…`; всегда предпросмотр и подтверждение | сырой отчёт 03, §4 | SHOULD |
   | FR-UI-281 | XHTTP | Решение владельца: форк ядра с XHTTP, Xray как доп. ядро только для XHTTP или «не поддерживается» с понятным сообщением | сырой отчёт 04 | Решение владельца |

2. **Исправить неточные требования** — в описании каждого FR добавить строку «Уточнение (аудит 2026-10): …» с фактом из кода:

   | FR | Уточнение | Источник |
   |---|---|---|
   | FR-UI-029 | Один общий флаг на 5 диалогов; Edit Profile и диалог расшифровки ссылок можно открыть дважды | `ui/mainwindow.cpp`:596-606, 1091 |
   | FR-UI-047 | `title_error` нигде не присваивается | `ui/mainwindow.cpp`:857 |
   | FR-UI-090a | Есть шестая сеть `quic` | `ui/edit/dialog_edit_profile.ui`:258-267 |
   | FR-UI-090d | REALITY включается непустым `reality_pbk`, а не пунктом списка | `ui/edit/dialog_edit_profile.cpp`:89-98 |
   | FR-UI-131, 148 | `domain_strategy`, `direct_dns_strategy`, `dns_final_out` не влияют на конфиг | `db/ConfigBuilder.cpp` (ссылок нет), `ui/dialog_manage_routes.cpp`:143-174 |
   | FR-UI-132 | Режимы sniffing «для маршрута» и «для назначения» дают одно правило | `db/ConfigBuilder.cpp`:734 |
   | FR-UI-139, 148 | Значения исходов в файлах — `proxy`/`bypass`/`block` | `ui/dialog_manage_routes.ui` |
   | FR-UI-164 | `old_share_link_format` не сохраняется | `main/NekoGui.cpp`:229-286 |
   | FR-UI-178 | Подпись стека в UI не совпадает с реальным стеком; MTU вне 1000..10000 сбрасывается в 9000 | `ui/dialog_vpn_settings.ui`:40-56; `fmt/Preset.hpp`:5 |
   | FR-UI-179 | На macOS повышения прав нет, TUN молча не включается | `ui/mainwindow.cpp`:744-770 |
   | FR-UI-188 | При любом конфликте не регистрируется ни один из 4 хоткеев | `ui/mainwindow.cpp`:1737-1740 |
   | FR-UI-198 | Расшифровка ссылок синхронна в GUI-потоке (до 13 с) | `ui/dialog_*_decrypt.cpp`:73-78 |
   | FR-UI-203 | «Stop Testing» останавливает поток GUI, а не воркеры | `ui/mainwindow_grpc.cpp`:74-81 |
   | FR-UI-072 | Сортировка нестрогая при непустых отчётах | `ui/mainwindow.cpp`:988-1016 |
   | FR-UI-055, 111 | Esc в режиме выбора очищает Front Proxy | `ui/mainwindow.cpp`:206-209 |
   | FR-UI-223 | Защиты «только при Mixed-порту» нет | `ui/mainwindow.cpp`:717-738 |

3. **Пометить сознательные отказы** (в таблицах, колонка «Приоритет» → «DROP (аудит 2026-10): причина»): FR-UI-019, 029, 041 (семантику области действия сохранить), 057, 059, 061, 073, 076, 087, 089, 166/240, 167, 238, 239, 241 — Qt-механика; FR-UI-095, 099, 145, 175, 183, 233–235 и поля «Force use external core» — внешние ядра; FR-UI-180–183 — внешний TUN двумя процессами (шаблон `res/vpn/sing-box-vpn.json` содержит удалённый outbound `dns`); FR-UI-131, 148, третий режим sniffing, FR-UI-248, FR-UI-236 — мёртвое; FR-UI-002/003, 060 — заглушки; FR-UI-224 — устаревший API macOS. **Не отказываться** от FR-UI-169/213/254 (соединения) — см. FR-UI-274.
4. В разделе 20 (UX-проблемы) у каждого пункта добавить ссылку на экран прототипа v1.2, где проблема решена.

**Готово, когда:** раздел 21 содержит FR-UI-257…281; у 16 FR есть «Уточнение»; у отказов есть причина; ни одно существующее FR не удалено.

---

## C2. `docs/AUDIT.md`

Добавить в начало блок «Поправки аудита 2026-10» и исправить по тексту:

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
| §6 | Расшифровка ссылок «без паник» | Неверно: `body[14:22]` паникует при длине тела 13–21 — `<файл расшифровки>.go`:250-269 (LNB-13) |
| §7.0 | sing-box на `b47a09e` без neko-слоя | Устарело: HEAD `628a9ed`, есть `box_neko.go`, `boxapi/` |
| §8 | Билдер «~850+240 строк, 1:1» | Ядро порта 4 444 строки C++ (таблица из сырого отчёта 02, §2.1); перенос 1:1 закрепит дефекты (hy2 `hop_ports`, нет `cache_file`) |
| §9 | 3–6 тыс. строк, 4–8 недель | 5–7 тыс. строк Go без тестов; плюс oracle, импортёр NekoBox, санитайзер логов, SSRF-безопасный fetcher, супервизор |
| §9.1 | HTTP-API: `0.0.0.0` + статичный токен, TLS опционально; `Start(core_config)` | Десктоп — без TCP (IPC Tauri + unix-socket/named pipe); веб — вход с паролем, привязка к адресу LAN, HTTPS; API на сущностях, без сырого конфига (сырой отчёт 03, §4) |

Добавить раздел «11. Golden-тесты паритета» — перенести из сырого отчёта 02 §2.2 таблицу поведений и §2.3 структуру корпуса `testdata/` целиком.

---

## C3. `docs/BUGS.md`

1. В сводную таблицу добавить колонку «Проверка 2026-10» со значениями из сырого отчёта 03 §1: CONFIRMED — 01, 02, 03, 06, 07, 08, 09, 10, 11, 13, 16, 17, 18, 19, 20, 21, 22, 23; PARTIAL — 04, 12, 24; OVERSTATED — 05, 14; NOT CONFIRMED — 15. Для каждой — поправка серьёзности и уточнённые строки (LNB-09: `ui/mainwindow.cpp`:1790; LNB-10: `TrafficLooper.cpp`:106-116; LNB-04: файл `groups/nekobox.json`; LNB-15: реальный дефект — ссылки hy2/tuic без порта отвергаются, порта по умолчанию 443 нет).
2. Добавить новые записи LNB-25…LNB-34 в формате существующих (заголовок, серьёзность, где, сценарий, план исправления в LAVRay, регрессионный тест):

   | ID | Серьёзность | Суть | Где |
   |---|---|---|---|
   | LNB-25 | critical | Подписка → запись файлов: `nekoray://` несёт `c_cfg`, MergeJson без фильтра, `external_ui_download_url` распаковывает zip без защиты от `..`; срабатывает в тесте задержки | `sub/GroupUpdater.cpp`:61-69; `db/ConfigBuilder.cpp`:32-70, 82-89; `ui/mainwindow_grpc.cpp`:162; `sing-box/experimental/clashapi/server_resources.go`:97-125 |
   | LNB-26 | major | Повышение прав через файлы пользователя: pkexec/osascript-скрипт и конфиг из `config/`, UAC-запуск ядра с конфигом пользователя | `ui/mainwindow.cpp`:1790-1813; `db/ConfigBuilder.cpp`:803-848 |
   | LNB-27 | major | `pkexec setcap` из PATH пользователя; `cap_net_admin` на переносимый бинарь | `sys/linux/LinuxCap.cpp`:21, 37-50; `ui/mainwindow.cpp`:751 |
   | LNB-28 | major | Секреты в логах: `core_config` при `-debug`, env и argv внешних ядер, результат QR, URL с токенами в ошибках | `go/cmd/nekobox_core/grpc_box.go`:41-43; `sys/ExternalProcess.cpp`:13, 52; `ui/mainwindow.cpp`:1340 |
   | LNB-29 | major | Деструктивное обновление подписки: пустой/мусорный ответ удаляет все профили группы; off-by-one `deleted_index > 0` | `sub/GroupUpdater.cpp`:566-573, 610, 620-624 |
   | LNB-30 | major | Цепочка поставки CI: Qt без хеша, `ghr` с токеном, actions по тегам, `ACTIONS_ALLOW_UNSECURE_COMMANDS`, короткий SHA зависимостей, релизы mutable без подписей | `libs/download_qtsdk_win.sh`:4-6; `.github/workflows/build-nekoray-cmake.yml`:72, 164, 215; `libs/get_source_env.sh`:3 |
   | LNB-31 | minor | Remote rule-set с изменяемой ветки без хеша, `download_detour: direct` | `db/ConfigBuilder.cpp`:474-475; `libs/build_public_res.sh`:9-12 |
   | LNB-32 | minor | Секреты внешних ядер во временных файлах, чистка только при старте; `LoadLibrary("DBGHELP.DLL")` по имени; nil-deref `Test` без recover | `fmt/Bean2External.cpp`:145, 213, 254; `sys/windows/MiniDump.cpp`:28; `go/cmd/nekobox_core/grpc_box.go`:126 |
   | LNB-33 | minor | «Allow LAN» = `::` без авторизации; VPN-шаблон пропускает мимо туннеля любой процесс с именем ядра | `ui/mainwindow.cpp`:319-322; `res/vpn/sing-box-vpn.json` |
   | LNB-34 | minor | `release_url` открывается без проверки схемы; заметки как AutoText | `ui/mainwindow_grpc.cpp`:518, 550; `go/grpc_server/update.go`:75-92 |
   | LNB-35 | major | Hysteria2 port hopping: `hop_ports` и целый `hop_interval` вместо `server_ports` и строки длительности | `fmt/Bean2CoreObj_box.cpp`:200-203 |
   | LNB-36 | major | Нет `cache_file`: rule-set качается на каждом старте, без сети старт падает | `db/ConfigBuilder.cpp`:758-770 |

   Подробности сценариев и исправлений — из сырого отчёта 03, §2 (N-01…N-10) и сырого отчёта 02, §3.
3. В раздел 4 «Рекомендации» добавить пункты: allowlist ключей MergeJson; запрет `c_cfg` у импортированных профилей; помощник с правами; страж восстановления; TUF-lite (ссылка на UPDATE-SYSTEM v2).

---

## C4. `docs/UPDATE-SYSTEM.md` → v2.0

Переписать документ. Обязательная структура и содержание:

1. **Принципы** — пять из v1.0 плюс: «доверие даёт подпись, а не хост»; «молчание ≠ нет обновлений»; «откат выполняет старая версия».
2. **Модель угроз** — таблица: компрометация аккаунта и CI, кража ключа, freeze, откат на старую подписанную версию, mix-and-match, подмена канала, повтор манифеста, MITM и DNS-подмена, блокировка GitHub, частичная загрузка, подмена пресетов и geo. Для каждой — мера.
3. **Метаданные (TUF-lite)** с примерами JSON:

   ```json
   {"signed":{"type":"root","version":1,"expires":"2027-10-01T00:00:00Z",
     "keys":{"k1":{"alg":"ed25519","pub":"<base64>"},"k2":{"alg":"ed25519","pub":"<base64>"},"k3":{"alg":"ed25519","pub":"<base64>"},
             "t1":{"alg":"ed25519","pub":"<base64>"},"r1":{"alg":"ed25519","pub":"<base64>"}},
     "roles":{"root":{"keyids":["k1","k2","k3"],"threshold":2},"timestamp":{"keyids":["t1"],"threshold":1},
              "manifest":{"keyids":["r1"],"threshold":1},"sources":{"keyids":["r1"],"threshold":1}}},
    "signatures":[{"keyid":"k1","sig":"<base64>"},{"keyid":"k2","sig":"<base64>"}]}
   ```

   ```json
   {"signed":{"type":"timestamp","version":1207,"expires":"<now+7d>",
     "meta":{"manifest-stable.json":{"serial":42,"sha256":"<hex>","length":2817},"manifest-beta.json":{"serial":57,"sha256":"<hex>","length":2903}}},
    "signatures":[{"keyid":"t1","sig":"<base64>"}]}
   ```

   ```json
   {"signed":{"type":"manifest","product":"lavray-windows","channel":"stable","serial":42,"expires":"<now+30d>",
     "app":{"version":"1.2.0","minUpgradeFrom":"1.0.0","assets":{"windows-x64":{"path":"v1.2.0/LAVRay-1.2.0-x64-setup.exe","sha256":"<hex>","length":12345678,"minisig":"<minisign>"}}},
     "core":{"version":"1.14.1-lav.1","minApp":"1.2.0"},
     "presets":{"lav-ru":{"rev":43,"path":"presets/lav-ru-43.json","sha256":"<hex>"},"lav-cn":{"rev":5,"path":"presets/lav-cn-5.json","sha256":"<hex>"}},
     "geo":{"path":"geo/2026-10-20.tar.zst","sha256":"<hex>","length":3456789},
     "notes":{"ru":"…","zh":"…","en":"…","es":"…","de":"…"},"mandatory":false},
    "signatures":[{"keyid":"r1","sig":"<base64>"}]}
   ```

   ```json
   {"signed":{"type":"sources","version":3,"expires":"<now+180d>",
     "artifacts":["https://github.com/<org>/lavray-windows/releases/download/","https://codeberg.org/<org>/lavray-windows/releases/download/",
                  "https://updates-a.<domain>/lavray-windows/","https://updates-b.<other-domain>/lavray-windows/"],
     "metadata":["https://<org>.github.io/lavray-windows/meta/","https://cdn.jsdelivr.net/gh/<org>/lavray-windows@meta/","https://updates-a.<domain>/meta/"]},
    "signatures":[{"keyid":"r1","sig":"<base64>"}]}
   ```

   Правила: клиент хранит последний `root.version`, максимальный `serial` по каждому каналу и `expires`; отвергает меньший `serial`, чужой `product` или `channel`, истёкший `timestamp`. Ротация root — новый `root.json`, подписанный порогом старых ключей; отзыв ключа — удаление из `keys` в новой версии root.
4. **Ключи и CI**: офлайн root-ключи у 2–3 человек на аппаратных токенах; онлайн-ключи `timestamp` и `manifest` со сроком; подпись релиза вне CI или в защищённом Environment с ревью; аппаратная 2FA; защищённые теги; `permissions: read` по умолчанию; actions по SHA; immutable releases; provenance; воспроизводимая сборка (`-trimpath`, `SOURCE_DATE_EPOCH`); процедура аварийной ротации в `SECURITY.md`.
5. **Алгоритм клиента**: (а) `timestamp.json` параллельно минимум из двух источников метаданных (connect 3 с, первый байт 5 с), берётся наибольший валидный; (б) проверка цепочки root → timestamp → manifest; (в) артефакт с любого источника из `sources.json` с докачкой; проверка длины, sha256, minisign; (г) копия в защищённый каталог и повторная проверка перед запуском; (д) сначала через активный туннель, затем напрямую; DNS — через DoH ядра; (е) запоминание последнего рабочего источника; (ж) состояние «последняя успешная проверка N дней назад», предупреждение после 7 дней, красный статус после 30; (з) офлайн-путь «Установить из файла» (инсталлятор + `.minisig` + манифест). Проверки — не чаще раза в 6 ч, с джиттером, без идентификаторов, через туннель, если он поднят.
6. **Установка и откат по платформам**:
   - Windows: per-machine NSIS + служба; хуки NSIS останавливают сайдкар, снимают TUN и системный прокси [проверь API Tauri]; прошлый инсталлятор хранится; откат выполняет маленький помощник старой версии (или служба) по отсутствию heartbeat новой.
   - macOS: только из «Программ» (иначе App Translocation); Developer ID + notarization обязательны до публичного релиза; помощник SMAppService.
   - Linux: AppImage — встроенный updater без TUN или с systemd-помощником; `.deb` — apt-репозиторий с `signed-by` и `Valid-Until`, обновление `apt-get install --only-upgrade lavray`; пул пакетов на Releases/CDN, индекс на Pages.
   - OpenWrt: **два фида** — ipk + usign (24.10) и apk + подпись (25.12+); имена пакетов `lavrayd`, `luci-app-lavray`, `lavray-webui` во всех документах одинаковые; ключ фида кладётся в `/etc/opkg/keys/` или `/etc/apk/keys/` до обновления (отпечаток публикуется вне GitHub); скрипт `lavray-update` выбирает рабочее зеркало и переписывает URL фида; прошлый пакет хранится локально; watchdog procd: «нет связи N минут после обновления → откат»; обновляются только пакеты LAVRay; статус и логи — в tmpfs; geo — не чаще раза в неделю; отказ при свободном месте < 2× пакета.
7. **Ядро**: отдельная доставка разрешена по тому же манифесту с полем `minApp`; версия ядра — своя схема (`1.14.1-lav.N`), не semver-сравнение с upstream.
8. **Пресеты и geo**: подписываются тем же механизмом; обновление пресета с пользовательскими правками — только через diff.
9. **Каналы**: переход stable → beta — с подтверждением; beta → stable — ожидание, пока stable догонит, или явный даунгрейд с бэкапом данных.
10. **Тесты** (CI): позитив/негатив подписи, просроченный timestamp, меньший serial, чужой канал, недоступный GitHub при доступном зеркале, частичная загрузка, подмена на редиректе, занятые файлы сайдкара, неработающая новая версия → откат, opkg и apk в контейнерах SDK, zip-slip и симлинки в архивах.

---

## C5. Новый `docs/THREAT-MODEL.md`

Структура: 1) Активы (ключи и пароли серверов, токены подписок, трафик пользователя, ключи подписи релизов, учётная запись GitHub, веб-панель роутера); 2) Субъекты (провайдер подписки — полудоверенный; веб-страница в браузере пользователя; локальная программа того же пользователя; другое устройство LAN; сеть/провайдер/DPI; злоумышленник с доступом к CI); 3) Границы доверия (UI ↔ Rust ↔ ядро; ядро ↔ помощник с правами; приложение ↔ источники обновлений; веб-панель ↔ браузер в LAN); 4) Таблица угроз «угроза → вектор → мера → где в архитектуре → тест» — не меньше: подписка → RCE (LNB-25), CSRF/DNS-rebinding к localhost, перебор пароля панели, подмена файлов для помощника (LNB-26/27), loopback-SOCKS без пароля, утечка секретов в логах (LNB-28), XSS из имён профилей → IPC, deep link-импорт, подмена буфера обмена, компрометация канала обновлений (C4), подмена rule-set, утечки DNS/IPv6, детект VPN российскими сервисами (имя адаптера, порты, системный прокси); 5) Остаточные риски и решения владельца.

## C6. Новый `docs/SECURITY.md`

Канал сообщений об уязвимостях (адрес, PGP или GitHub Security Advisories), сроки ответа, поддерживаемые версии, процедура аварийной ротации ключей подписи (шаги, кто, как оповестить пользователей через `root.json`), отпечатки ключей и где они опубликованы вне GitHub.

## C7. Новый `docs/OPENWRT-GATEWAY.md`

1. **Цели и поддержка:** OpenWrt 24.10 (opkg) и 25.12+ (apk); архитектуры `x86_64`, `aarch64_cortex-a53` (MediaTek Filogic: GL.iNet MT3000/MT6000, Xiaomi AX3000T, Cudy), `aarch64_cortex-a72` (Raspberry Pi 4), `aarch64_generic`; `mipsel_24kc` — явно не поддерживается; минимум 256 МБ RAM и 64 МБ свободного overlay (или extroot).
2. **Пакеты:** `lavrayd` (ядро + API), `lavray-webui`, `luci-app-lavray`; зависимости `kmod-tun`, `kmod-nft-tproxy`, `ca-bundle`.
3. **Режим шлюза:** схема nftables (fw4 include) для TProxy: таблица `inet lavray`, исключения `geoip:private`, адреса роутера, трафик самого `lavrayd` по `meta skuid`/`mark`; перехват DNS (dnsmasq → ядро или `hijack-dns`); IPv6 — включено/выключено явно; режим TUN как альтернатива.
4. **Устройства LAN:** политики на устройство по MAC (через прокси / напрямую / по пресету); гостевая сеть по умолчанию напрямую.
5. **Отказоустойчивость:** watchdog procd: ядро упало или нет связи N минут → снять правила nftables, интернет без прокси, уведомление в панели.
6. **Веб-панель и LuCI:** привязка к адресу LAN из UCI (не `0.0.0.0`), вход по паролю (FR-UI-278), HTTPS с самоподписанным сертификатом и отпечатком в LuCI, CSP, `frame-ancestors 'none'`; LuCI — клиентский JS + rpcd/ucode с ACL.
7. **Ресурсы:** `GOMEMLIMIT`, минимальные build-теги, статус и логи в tmpfs, geo не чаще раза в неделю.
8. **Обновления:** ссылка на UPDATE-SYSTEM v2 §6 (OpenWrt).

## C8. Новый `docs/TEST-PLAN.md`

Наборы (уровень Доктрины, инструмент, гейт): oracle-паритет билдера и `sing-box check`; фаззинг парсеров (расшифровка ссылок, base64, ссылки, Clash YAML); match-тесты маршрутизации и DNS; миграция NekoBox (корпус реальных обезличенных конфигураций); безопасность API (CSRF, Origin/Host, DNS-rebinding, перебор пароля, capabilities Tauri, deep link, импорт с `c_cfg`, zip-slip); доступность (`design/tools/*.py` + axe-core на React-версии + ручной NVDA/VoiceOver); локализация (псевдолокаль, `i18n_check.py`, плюрализация); сеть и жизненный цикл (kill -9, сон, смена сети, captive portal, IPv6-only, потери, подписка-заглушка); обновления (C4 §10); E2E (Playwright для веб-режима, tauri-driver для Windows/Linux; для macOS — альтернатива [проверь поддержку WebDriver для WKWebView]). Бюджеты производительности (из отчёта 5.4): холодный старт до первого кадра p50 ≤ 600 мс, p95 ≤ 1000 мс; до «готов к подключению» ≤ 1500 мс; UI в простое ≤ 120 МБ; ядро с LAV Preset RU ≤ 60 МБ; в трее ≤ 70 МБ; установщик Windows ≤ 25 МБ; CPU в простое ≤ 1 %. Критерий выхода из рекурсии Доктрины: рубрика серьёзности (critical / major / minor / вкус), не больше 3 раундов на модуль, минорные и вкусовые — в issue, решение о выходе подписывает человек.

## C9. Новые `docs/LICENSES.md` и `docs/PLATFORM-MATRIX.md`

- `LICENSES.md`: таблица компонентов (LAVRay, ядро-форк, Tauri, React, Lucide, шрифты, wintun.dll, WebView2 Runtime, наборы geosite/geoip MetaCubeX/v2fly/Loyalsoldier, материалы стороннего клиента) — лицензия, условия распространения, что показать в «О программе → Лицензии», статус проверки [проверь]. Отдельный блок «Правовые вопросы владельцу»: условие `sing-box/LICENSE`:16 об имени; ключи стороннего клиента в `go/cmd/nekobox_core/<пакет расшифровки>/assets/*.json` (риск DMCA; варианты из отчёта 5.5); подпись кода из РФ (варианты); формулировки о «обходе блокировок» (законодательство РФ) — со ссылкой «нужна консультация юриста».
- `PLATFORM-MATRIX.md`: строки — функции (системный прокси, TUN, трей, автозапуск, глобальные хоткеи, уведомления, процессные правила, kill switch, обновления, deep link, шрифт), столбцы — Windows 10/11, macOS 13+, Ubuntu 22.04/24.04 GNOME (X11/Wayland), KDE, OpenWrt; ячейки — «да / нет / с условием (какое)». Источники: отчёт 2.3, сырой отчёт 04.

## C10. Прочие документы

1. `docs/PRESET-LAV-RU.md`: добавить разделы «Региональные пресеты» (LAV Preset CN и «Глобальный» с правилами из `01-prototype.md`, A10), «Подпись и обновление пресетов» (ссылка на UPDATE-SYSTEM v2), «Правило рекламы» (`geosite:category-ads-all` → блок), «Платформенные правила» (процессы `*.exe` — только Windows; на OpenWrt процессных правил нет).
2. Новый `docs/I18N-GLOSSARY.md` — таблица раздела 8 из `03-i18n.md` плюс правила раздела 1 оттуда же.
3. `docs/REVIEW-VISUAL.md`: в начало вставить «Статус (2026-10): ревью выполнено по токенам v1.0 и скриншотам старше прототипа v1.1; актуальные результаты — `docs/REVIEW-A11Y-v1.2.md`». Создать `docs/REVIEW-A11Y-v1.2.md` с выводом последних прогонов `token_contrast.py`, `i18n_check.py`, `kbd_probe.py`, `a11y_sweep.py` и списком принятых исключений `data-a11y-ignore`.
4. `docs/REVIEW-I18N.md`: в начало — «Статус (2026-10): 22 из 31 замечания исправлены в v1.1; остальные и новые — `docs/fix-plan/03-i18n.md`».
5. Мусор в `design/`: удалить `design/shots$1.png` и пустую `design/shots/`; исправить комментарий в `init` прототипа (`mode=app` → `mode=native|browser`).
