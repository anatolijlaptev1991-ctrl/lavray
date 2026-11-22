# Пресет «LAV Preset RU» — анализ и план интеграции в LAVRay

**Источник:** репозиторий `nekobox-ru-bypass-games`, файл `RU-bypass + Games` (формат маршрутов NekoRay/NekoBox 4.x, ядро sing-box).
**Роль в LAVRay:** встроенный (зашитый в сборку) маршрутный пресет с человеческим именем **«LAV Preset RU»**, доступный «из коробки» на всех платформах.
**По умолчанию:** с 0.9.3 активен у новых установок (дескриптор `routing.active_preset`). Установленным копиям с серверами, где набор не выбирали, при первом запуске записывается `global`, чтобы маршруты не сменились (`store.settleDefaultPreset`).

## 1. Что делает пресет (семантика)

| Трафик | Путь |
|---|---|
| Русские сайты (`.ru`, `.su`, `.рф`, gov, category-ru) | напрямую |
| Игровые домены: Riot, Steam, Photon/Exitgames | напрямую |
| Blizzard, Battle.net и World of Warcraft (с rev 5, §3f) | напрямую |
| `bogolubov.center` и его поддомены (`www.`, `lk.`) (с rev 5, §3g) | напрямую |
| Обновления и магазины приложений Linux: Ubuntu/Launchpad/snap, Debian, Flathub (`dl.flathub.org`), Fedora, Arch | напрямую (с rev 4, §3e) |
| BigModel (`bigmodel.cn`), DeepSeek (`deepseek.com`), Kimi (`kimi.com`, `kimi.ai`), Moonshot (`moonshot.cn`, `moonshot.ai`) — суффиксные правила, покрывают поддомены (в т.ч. `open.bigmodel.cn`, `api.deepseek.com`, `api.kimi.ai`) | напрямую (с rev 3) |
| Игры по имени процесса (Windows): LoL (весь стек + Vanguard), Icarus, PEAK, Phasmophobia (+ Unity crash handler), World of Warcraft: Forever и Battle.net (с rev 5, §3f) | напрямую |
| AI/IDE-инструменты по имени процесса: Cursor, Windsurf, Kimi, VS Code, Claude, Codex, Gemini, ollama, LM Studio, Jan, node/python и др. | через прокси |
| AI/Dev-домены: Google/Gemini, OpenAI, Anthropic/Claude, xAI/Grok, Perplexity, HuggingFace, GitHub, npm, PyPI и др. (большой явный список) | через прокси |
| Всё остальное (`def_outbound: proxy`) | через прокси |

**DNS:** раздельный — RU и игровые домены через локальный DNS провайдера (низкий пинг), остальное через DoH `https://dns.google/dns-query` через туннель (`dns_final_out: proxy`, `dns_routing: true`, `sniffing_mode: 1`). `google.ru` явно закреплён за прокси (правило proxy приоритетнее category-ru). С rev 3 BigModel, DeepSeek и Kimi/Moonshot тоже резолвятся через локальный/прямой DNS (`dns-direct`), а не через DoH в туннеле. `zcode.z.ai` и `z.ai` (ZCode Start Plan) остаются через прокси.

**Почему записи перенесены, а не продублированы (rev 3):** правила `proxy` приоритетнее `direct`, поэтому `domain:bigmodel.cn`, `domain:deepseek.com`, `domain:kimi.com`, `domain:moonshot.cn`, `domain:moonshot.ai` удалены из `proxy_domain` и добавлены в `direct_domain` (дубль в обоих списках оставил бы трафик на прокси). `domain:kimi.ai` добавлен заново: он отсутствовал в пресете, и `api.kimi.ai` (API Kimi Code) уходил в `def_outbound: proxy`. `def_outbound` остаётся `proxy`.

## 2. Структура исходного файла (ключи формата NekoRay)

- `custom` — строка-JSON с расширенными правилами (здесь: два правила по `process_name` с исходящими `proxy`/`bypass`)
- `def_outbound` — исходящий по умолчанию (`proxy`)
- `direct_domain` / `proxy_domain` — списки доменов/geosite (по строке)
- `direct_ip` — geoip-списки (`geoip:ru`, `geoip:private`)
- `direct_dns` / `remote_dns` / `dns_final_out` / `dns_routing` / `sniffing_mode` / `use_dns_object` — DNS-поведение

## 3. План интеграции в LAVRay

1. **Формат пресетов LAVRay:** собственная схема (JSON, versioned) — надмножество ключей выше; конвертер из формата NekoRay 4.x (для импорта пользовательских пресетов и для этого файла) пишется один раз и покрывается тестами (в т.ч. на этот файл как эталонный вектор).
2. **Встраивание:** пресет упаковывается в ресурсы приложения (`presets/lav-ru.json`) и доступен в UI «Маршрутизация → Пресеты» с локализуемым именем «LAV Preset RU» (имя — не переводится автоматически, это бренд; описание пресета переводится на 5 языков).
3. **Приоритет правил при конфликте:** правила `proxy` (явный список) применяются перед `direct`-geosite — сохранить текущую семантику `google.ru`.
4. **Платформенные отличия:**
   - `process_name` работает на Windows/macOS/Linux (сопоставление процессов sing-box); на **OpenWrt процессов клиентских приложений нет** — при установке пресета на роутере процессные правила silently опускаются, в UI показывается предупреждение (локализованное).
   - `geoip:private` на OpenWrt критичен (не заворачивать LAN).
5. **Обновляемость:** пресет версионируется (поле `revision`); «Центр обновлений» умеет обновлять пресеты (fetch из репо `lavray`) независимо от версий приложения — домены AI-сервисов меняются часто. Обновление пресета никогда не перезаписывает пользовательские правки молча: если пресет кастомизирован — предлагается diff/merge.
6. **Тестирование (по Доктрине):** golden-тест конвертации в конфиг sing-box; тест приоритетов (google.ru → proxy, lori.ru → direct, LoL-процесс → direct, bigmodel.cn → direct, deepseek.com → direct, api.kimi.ai → direct, zcode.z.ai → proxy); тест на OpenWrt-профиле (процессные правила опущены, предупреждение показано); fuzzing на входе конвертера.
7. **Регрессионная привязка:** BUGS.md — счётчик «пресет применён и активен после обновления приложения» (не должен сбрасываться).

## 3a. Региональные пресеты (добавлено аудитом 2026-10)

Кроме «LAV Preset RU» в поставку входят два встроенных пресета (FR-UI-276; правила — по прототипу v1.2, задача A10 `docs/fix-plan/01-prototype.md`):

| Пресет | Правила | DNS | Предвыбор в онбординге |
|---|---|---|---|
| **LAV Preset RU** | см. раздел 1 | раздельный: RU/игры — DNS провайдера, остальное — DoH через туннель | язык ru |
| **LAV Preset CN** | domain direct: `geosite:cn`; ip direct: `geoip:cn`, `geoip:private`; domain proxy: `geosite:geolocation-!cn` | Китай — DNS провайдера, остальное — DoH через туннель | язык zh |
| **Глобальный** | ip direct: `geoip:private`; domain proxy: `*` (всё остальное через прокси) | всё — DoH через туннель | остальные языки |

Порядок карточек в UI: RU, CN, Глобальный, «Всё через прокси», «Всё напрямую», «Выборочный». Описания пресетов локализованы (`preset.lavcn.desc`, `preset.global.d`); описание «Авто» у DNS строится от активного пресета (`dns.auto.d.ru` / `dns.auto.d.cn` / `dns.auto.d.global`).

## 3b. Правило рекламы

Во встроенные пресеты добавлено правило блокировки рекламы и трекеров: `domain → block` для `geosite:category-ads-all` (примечание в UI — «Реклама и трекеры», `rule.n7`; задача A10.5). Правило присутствует и в пользовательских копиях, если не удалено явно; исход «Блок» доступен в редакторе правил.

## 3c. Платформенные правила

- Процессные правила с именами `*.exe` — **только Windows**: в UI они помечаются бейджем платформы «Windows» (`rt.plat.win`); на macOS и Linux такие правила показывают подпись «Не действует на этой системе» (`rt.plat.na`).
- Правил по приложениям для Linux и macOS во встроенных наборах нет: на Linux каждое процессное правило замедляет каждое соединение (§3e); платформенные правила можно добавить в свою копию набора.
- На **OpenWrt процессных правил нет** — при применении пресета на роутере они опускаются с предупреждением, а в UI помечаются «Не действует на роутере» (`rt.plat.router`).

## 3d. Подпись и обновление пресетов

Пресеты подписываются тем же механизмом, что и релизы (TUF-lite): секция `presets` манифеста содержит `rev`, `path` и `sha256` каждого пресета (см. `docs/UPDATE-SYSTEM.md` v2.0 §3.3 и §8). Обновление пресета с пользовательскими правками — только через diff; silent-перезапись запрещена. UI Центра обновлений показывает «Доступна редакция {rev}» и описание изменений (`upd.presetAvail`, `upd.presetDiff`).

## 3e. Linux: обновления напрямую, правил по приложениям нет (rev 4)

**Домены обновлений (rev 4).** В `direct_domain` добавлены домены системных обновлений и магазинов приложений Linux: `ubuntu.com`, `launchpad.net`, `launchpadcontent.net`, `snapcraft.io`, `snapcraftcontent.com`, `debian.org`, `dl.flathub.org`, `fedoraproject.org`, `archlinux.org` (суффиксные, покрывают поддомены: `archive.ubuntu.com`, `ru.archive.ubuntu.com`, `security.ubuntu.com`, `connectivity-check.ubuntu.com`, `api.snapcraft.io`, `ppa.launchpadcontent.net`, `deb.debian.org`, `mirrors.fedoraproject.org` и т. д.). Большие загрузки не нужно гнать через VPN, и они не блокируются: все перечисленные узлы проверены с мини-ПК в обход туннеля (выход RU). Не отвечал только корень `flathub.org`, загрузки с `dl.flathub.org` работают, поэтому в список вошёл именно он. Пересечений с `proxy_domain` и с пинами Riot в `custom_rules` нет (проверено по тексту списков; содержимое geosite `.srs` не сверялось). Списки общие для всех ОС: на Windows эти домены безвредны. DNS этих доменов идёт через `dns-direct`, как и у остального `direct_domain`. Источник NekoRay получает те же домены, `TestGoldenLavRU` сходится.

**Правил по приложениям на Linux по умолчанию нет.** Windows-набор (`*.exe`) остаётся, для Linux ни одного процессного правила во встроенных наборах нет; это закреплено тестами (`TestBuiltinsHaveNoLinuxProcessRules` — пустой `platforms` тоже считается действующим на Linux; `TestLavRULinuxConfigHasNoProcessLookup` и golden G28b — в конфиге lav-ru для Linux нет `process_name`, `process_path*` и `find_process`).

Причина — цена. В sing-box любое правило с `process_name` включает поиск процесса для КАЖДОГО нового соединения с локальным источником, до сопоставления любых правил, включая `hijack-dns`. Поиск: запрос netlink `sock_diag` (inode и uid сокета; дёшево), затем перебор `/proc/<pid>/fd` всех процессов этого пользователя с `readlink` на каждый fd. Кэшей два: в маршрутизаторе (ключ — соединение, 200 мс; убирает только повторы того же потока) и в поисковике (карта inode → exe на пользователя, 1 с). Карта пересобирается целиком всякий раз, когда нужного inode в ней нет, то есть для нового соединения цена — полный перебор `/proc`. Если процесс не найден (чужой пользователь), перебор выполняется дважды.

Замер 2026-11-14 (Intel N100, 134 процесса пользователя, 300 новых соединений через mixed-вход, одно правило «игры напрямую»: steam, steamwebhelper, wine-preloader, wine64-preloader, moonlight):

| | без правил | с одним процессным правилом |
|---|---|---|
| медиана на соединение | 0,86 мс | 12,98 мс |
| p95 | 2,15 мс | 15,46 мс |
| CPU ядра на соединение | 1,1 мс | 14,0 мс |
| соединений в секунду | 945 | 75 |

То есть в 15 раз дороже для каждого соединения в системе, включая браузер, а не только для приложений из правила. Трафик, пересылаемый через шлюз (телевизор за мини-ПК), поиск не включает: источник не локальный.

**Выгода маленькая.** В нашем порядке правил (sniff → hijack-dns → `custom_rules` пресета → block → proxy-домены → direct-домены → block/proxy/direct IP → процессные правила → TUN-bypass пользователя → встроенные блокировки) процессные правила стоят ПОСЛЕ списков и действуют лишь на то, что в списки не попало. Поэтому правило `proxy` по процессу при `def_outbound = proxy` ничего не меняет (то же исходящее, что и по умолчанию), а прямые списки (DeepSeek, Kimi, BigModel, `geoip:ru`, `geoip:private`) оно не перебивает. Реальный эффект мог бы дать только `direct` для игр на IP-адреса вне списков (Steam, Wine/Proton, Moonlight через интернет).

**Как добавить правила в свою копию набора и чего это стоит.** В пользовательской копии пресета (не во встроенном) можно добавить процессное правило, например `{"platforms": ["linux"], "outbound": "direct", "process_names": ["steam", "steamwebhelper", "wine-preloader", "wine64-preloader", "moonlight"]}`. Цена — таблица выше для всей системы, пока правило включено. Особенности имён: ядро сравнивает точное базовое имя из `/proc/<pid>/exe` с учётом регистра, без шаблонов; `python3` — ссылка на `python3.14`, виден `python3.14`; Electron-приложения (VS Code, Cursor, Windsurf, Antigravity) выполняют сеть в дочерних процессах того же exe; npm-инструменты идут как `node`; игры под Proton/Wine видны только как `wine-preloader`/`wine64-preloader`; нативный Claude Code — как `~/.local/share/claude/versions/<номер версии>`; после обновления пакета под запущенным приложением имя читается как `<...> (deleted)`. Не распознаются процессы других пользователей и служб (systemd-служба `ollama`, `apt` под `_apt`): без `CAP_SYS_PTRACE` ядро не читает их `/proc/<pid>/exe`. `process_path_regex` схема не поддерживает (SCHEMA §4.3: только имена без путей).

## 3f. World of Warcraft: Forever и Battle.net — напрямую (rev 5)

**Процессы (только Windows).** Имена добавлены в существующее правило «напрямую», третьего правила нет (порядок правил не менялся: сначала прокси, потом напрямую): `Wow.exe`, `WowVoiceProxy.exe`, `World of Warcraft Launcher.exe`, `BlizzardError.exe`, `BlizzardBrowser.exe`, `Battle.net.exe`, `Battle.net Launcher.exe`, `GameSessionMonitor.exe`, `battlenet.overlay.runtime.exe`. Имена взяты из установленной игры, а не подобраны: игра — `D:\World of Warcraft\_forever_`, клиент — `D:\Battle.net`. Для Linux процессных правил по-прежнему нет (§3e).

**Домены (все ОС).** В `direct_domain`: `domain:blizzard.com`, `domain:battle.net`, `domain:worldofwarcraft.com`, `domain:blz-contentstack.com`, `full:blzddist1-a.akamaihd.net`, `full:bnetcmsus-a.akamaihd.net`, `full:bnetproduct-a.akamaihd.net`. Источник — список `blizzard` из v2fly/domain-list-community; взяты только домены учётной записи, Battle.net и WoW. Корейские узлы, домены остальных игр Blizzard и магазин в пресет не входят.

**Зачем домены, если есть процессы.** Всё, что лежит в `direct_domain`, резолвится через `dns-direct` — DNS провайдера. Без этого адреса игровых серверов выбрались бы по выходу прокси, а шёл бы трафик из России. Домены срабатывают и для соединений от процессов, которых нет в правиле.

**Проверки.** Пересечений с `proxy_domain` и с пинами Riot в `custom_rules` нет (по тексту списков; содержимое geosite `.srs` не сверялось). `TestGoldenLavRU` сходится, `TestBuiltinsHaveNoLinuxProcessRules` зелёный, в Linux-конфиге поиска процессов нет (G28b). Обновлённые конфиги Windows и Linux приняты настоящим sing-box (`TestGoldenSingBoxCheck`, 38 из 38). На живой игре маршрут не проверялся: нужен запуск с пресетом rev 5.

## 3g. bogolubov.center — напрямую (rev 5)

**Правило.** `domain:bogolubov.center` в `direct_domain` — суффиксное, покрывает и поддомены (`www.bogolubov.center`, `lk.bogolubov.center`). DNS домена идёт через `dns-direct`. Добавлено по просьбе владельца; в ту же ревизию, что и §3f, потому что rev 5 ещё не выпущена.

**Почему мало правила по стране.** Сайт хостится в Москве, и его адрес есть в `geoip:ru`. Но в режиме системного прокси браузер отдаёт ядру имя сайта, а не адрес, и для такого соединения правило по стране не срабатывает — оно сравнивается с адресом, которого ещё нет. Сайта нет в `geosite:category-ru`, поэтому он доходил до `def_outbound` и шёл через прокси. Правило домена стоит до процессных правил и в `def_outbound` не попадает.

**Не входит.** Сайт ссылается на `bogolubov.expert` и `proc-servis.clinic` (карточки партнёров): это переходы, а не ресурсы страницы, — их в пресете нет. Другие внешние ресурсы страницы — ВКонтакте, MAX, Одноклассники, сайты госорганов — уже напрямую через `category-ru` и `gov-ru`.

**Проверки.** `TestLavRURev5DomainsGoDirect` держит домен в `direct_domain` и не пускает в `proxy_domain`; в golden G28 (Windows) домен — в правиле `bypass` и в правиле `dns-direct`, в G28b (Linux) — так же. Зонд на настоящем движке (форк sing-box, конфиг `Build()` для Windows без TUN, настоящие `geo/*.srs`, исходящий прокси — закрытый порт, 2026-11-22): по пресету без этого правила `bogolubov.center:443` ушёл в `outbound/socks[proxy]`; то же соединение по адресу `5.35.16.80:443` — в `outbound/direct[bypass]`; с правилом `bogolubov.center`, `www.bogolubov.center` и `lk.bogolubov.center` — в `outbound/direct[bypass]`, TLS и HEAD до сайта прошли. В режиме TUN и в установленном приложении не проверялся.

## 4. Риски

- geosite-данные (MetaCubeX/meta-rules-dat) должны быть скачаны/обновлены — прокинуть в LAVRay менеджер geo-активов с версионированием.
- Список процессов Windows-центричен (`*.exe`); на Linux процессных правил нет намеренно (§3e).
