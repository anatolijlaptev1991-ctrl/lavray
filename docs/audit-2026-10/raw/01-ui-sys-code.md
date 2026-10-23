# Сырой отчёт 01. Qt-UI и системная интеграция NekoBox против REQUIREMENTS.md

> Проверка-субагент аудита 2026-10-23 (статическое чтение кода, приложение не запускалось). Основной отчёт — `docs/AUDIT-CLAUDE-2026-10.md`; при расхождении приоритет у него и у `docs/fix-plan/`.

Прочитано целиком: `ui/*` вместе со всеми `.ui`, `ui/edit`, `ui/widget`; `main/*`, `sys/*`; из `3rdparty`: QvProxyConfigurator, RunGuard, WinCommander, QvAutoCompleteTextEdit, JsonEditor, KeySequenceEdit, wrapper.hpp; `res/vpn`, `libs/*.sh`; `translations` (только счётчики). `sub/`, `db/`, `fmt/` и `sing-box/` — точечно, для сверки. Пути — от `D:/ZCode/nekobox/nekoray/`.

Сокращения: MW = `ui/mainwindow.cpp`; MWG = `ui/mainwindow_grpc.cpp`; DBS = `ui/dialog_basic_settings.cpp`; DMR = `ui/dialog_manage_routes.cpp`; DEP = `ui/edit/dialog_edit_profile.cpp`; CB = `db/ConfigBuilder.cpp`; QPC = `3rdparty/qv2ray/v2/components/proxy/QvProxyConfigurator.cpp`. Поведение Qt, неочевидное из кода, помечено [проверь].

## 1. Пробелы: функции и пути ошибок без FR

| # | Что | Источник | Приоритет | Причина |
|---|---|---|---|---|
| 1 | Системный прокси: на Windows нет bypass-списка (закомментирован). «Выкл» ставит принудительно DIRECT/none/off без снимка прежнего состояния, затирает PAC/WPAD пользователя. После краша прокси не зачищается. `LOG/DEBUG` — пустые макросы. Флаг `spmode_system_proxy` ставится даже при сбое. | QPC:152,186-189,388; `3rdparty/qv2ray/wrapper.hpp`:8-13; MW:414-422,717-738 | MUST | После падения у пользователя «нет интернета». |
| 2 | Старт при лежащем ядре: рестарт ядра и отложенный старт. Смена профиля идёт как stop→start через семафор. Параллельный start/stop режется модалкой «Another profile is starting/stopping…». | MWG:351-386 | MUST | Основа конечного автомата. AUDIT §1.3 описывает отложенный старт только для remember. |
| 3 | Подписка через свой прокси: именно HTTP-proxy к mixed (SOCKS5 даёт «protocol error»). Передаются креды inbound_auth. Есть ранний отказ «Request with proxy but no profile started». | `main/HTTPRequestHelper.cpp`:18-32 | MUST | FR-UI-117 говорит только «опционально через прокси». |
| 4 | Нет валидации чисел и адресов. `test_concurrent=0` даёт вечный дедлок: control-поток дважды берёт `lock_return`, а `speedtesting` навсегда true. Порт вне 1..65535 — mixed-in молча не создаётся. `inbound_address` и URL — свободный текст. | DBS:67-75,222; MWG:124-141,239; CB:396 | MUST | Тихие отказы. |
| 5 | «Allow other devices» ставит `::` без предупреждения и без обязательной авторизации. | MW:257,319-322 | MUST | Открытый прокси в LAN. |
| 6 | Повышение прав. Windows: приложение завершается до UAC, при отказе не перезапускается (код возврата игнорируется). macOS: ветки нет. Linux: проба `pkexec`, `setcap` по realpath симлинка, подсказка про AppImage. | MW:697-710,744-770; `main/NekoGui.cpp`:435-440; `sys/linux/LinuxCap.cpp`:27-35 | MUST | Сначала поднять elevated-процесс, потом закрывать текущий. |
| 7 | Битый JSON настроек молча даёт дефолты и затем перезаписывается. Запись не атомарна, ошибки open/write игнорируются. | `main/NekoGui.cpp`:172-198; `main/main.cpp`:187-190 | MUST | Это причина U-10 «настройки не сохраняются». |
| 8 | Карточка подписки: нет `total=` — пусто; нет `expire` — «1970»; Remain может быть меньше 0. | `ui/widget/GroupItem.cpp`:19-39 | MUST (исправить, не портировать) | Видимый баг. |
| 9 | Редактор правил: Space/Tab блокируются тултипом, Tab не выводит фокус (ловушка). Подсказки берутся из geosite.dat/geoip.dat (v2fly/Loyalsoldier), а правила уходят в MetaCubeX `.srs`. Без `.dat` подсказок нет, и молча. | `3rdparty/qv2ray/v2/ui/QvAutoCompleteTextEdit.cpp`:96-101; DMR:66-77; `libs/build_public_res.sh`:10-11 | SHOULD | Нужен единый каталог тегов и инлайн-валидация. |
| 10 | Имя набора маршрутов не санитизируется (`../`). Синтаксис и CIDR при сохранении не проверяются. Remove последнего набора молча игнорируется. | DMR:218-222,232 | SHOULD | Валидация. |
| 11 | Плейсхолдер DNS Object — legacy-JSON (`fakeip:{}`, `independent_cache`). Ядро 1.14 такое отвергает. | DMR:29; `sing-box/option/dns.go`:45 | SHOULD | Дополняет LNB-08. |
| 12 | Network `quic`. REALITY `spx` читается и пишется в ссылках, но поле скрыто и в core-конфиг не идёт. | DEP.ui:258-267; DEP:93-94; `fmt/Bean2CoreObj_box.cpp`:59-63 | SHOULD | Round-trip ссылок. |
| 13 | В «New profile» смена типа пересоздаёт ent и стирает введённое. Правка профиля из запущенной цепочки или front-proxy не предлагает рестарт (проверяется только `started_id==ent->id`). | DEP:194-197,269-271,385-386 | SHOULD | Потеря ввода, неверное состояние. |
| 14 | Chain: выбранный chain-in-chain молча отбрасывается. Пустая цепочка сохраняется. Порядок меняется только через DnD. | `ui/edit/edit_chain.cpp`:54,73; `edit_chain.ui`:35-40 | SHOULD | Тихие отказы, нет клавиатурной альтернативы. |
| 15 | Группа: новая принимает пустое имя и «Subscription» без URL. Remove не показывает число профилей. Для последней группы — молчаливый no-op. | `ui/edit/dialog_edit_group.cpp`:74-87; GroupItem.cpp:119-121 | SHOULD | Валидация и подтверждение. |
| 16 | QR: «data too long» даёт один messagebox «error». Quiet zone — 2 модуля. Результат скана целиком пишется в лог (секрет). | MW:1258-1274,1340 | SHOULD | Дополняет LNB-01. |
| 17 | Full Test: опции не запоминаются и не предвыбраны, пустой выбор молча отменяет. Таймауты тестов 10 с зашиты. | MWG:90-117,154,255 | SHOULD | Нужна настройка. |
| 18 | Окно: позиция и maximized не хранятся (только размер). Нет `isSystemTrayAvailable`. Трей-уведомлений нет вообще (`showMessage` не вызывается). | MW:445-450,631-637 | SHOULD | Без трея окно «теряется». |
| 19 | Автозапуск: запись Windows без `-appdata` (Linux — с ним). Linux `Exec=` без кавычек. macOS без `-tray`. Ошибки записи молча. | `sys/AutoRun.cpp`:19-24,185-189,212,192-205 | SHOULD | Расхождения между ОС. |
| 20 | Лог внешнего ядра печатает всё окружение процесса и аргументы. | `sys/ExternalProcess.cpp`:13,52 | DROP (вместе с внешними ядрами) | Утечка секретов, смежно с LNB-01. |

## 2. Неточности каталога

| FR | Заявлено → фактически | Источник |
|---|---|---|
| 029 | «Один экземпляр каждого диалога» → один общий флаг `dialog_is_using` на все 5 диалогов. Пока открыт любой, остальные (и по хоткею) молча не открываются. Диалоги немодальные (`show()`); Edit Profile и Happ без защиты, их можно открыть дважды. | MW:596-606,1091 |
| 047 | «[ошибка]» в заголовке → `title_error` нигде не присваивается. | MW:857; `ui/mainwindow.h`:152 |
| 090d | Security «(пусто)/tls/reality» → в combo только «» и «tls». REALITY включается непустым `reality_pbk` внутри TLS-блока. | DEP.ui:300-311; DEP:89-98 |
| 090a | 5 сетей → в списке есть ещё `quic`. | DEP.ui:258-267 |
| 131/148 | Domain Strategy, Direct Query Strategy и Final DNS Out «работают» → ConfigBuilder их не читает. `remote_dns_strategy` уходит в глобальный `dns.strategy`. | CB:652-653,749-750 (ссылок нет) ↔ DMR:143,150-151 |
| 132 | 3 режима sniffing → «routing» и «destination» дают одно и то же правило. | CB:734 |
| 139/148 | proxy/direct/block → значения `proxy`/`bypass`/`block`. Так они лежат в `routes_box/*`, важно для импорта. | `ui/dialog_manage_routes.ui` (def_outbound, dns_final_out) |
| 164, Прил. А | `old_share_link_format` — настройка → не сохраняется (нет `_add`), после рестарта всегда true. | `main/NekoGui.cpp`:229-286; `NekoGui_DataStore.hpp`:101 |
| 178 | gvisor/system/mixed; MTU «клампится» → UI-список Mixed/gVisor/System, а индекс мапится на `{"gvisor","system","mixed"}`: подпись ≠ реальный stack. MTU вне 1000..10000 сбрасывается в 9000, не клампится. | `ui/dialog_vpn_settings.ui`:40-56; `fmt/Preset.hpp`:5; CB:422; `dialog_vpn_settings.cpp`:46-47 |
| 179 | macOS «см. FR-184» → для macOS нет ветки повышения прав, Tun молча не включается. | MW:744-770 |
| 188 | «Дубликаты не регистрируются» → при любом дубле не регистрируется ни один из 4 хоткеев. | MW:1737-1740 |
| 198 | Decrypt «асинхронно» → синхронно в GUI-потоке (до 3+10 с). Асинхронен только путь через GroupUpdater. | `ui/dialog_happ_decrypt.cpp`:73-78; `main/HappLink.cpp`:33 |
| 203 | Stop Testing «останавливает потоки» → в список кладётся `QObject::thread()` (поток GUI, не воркера). `run()` без event loop, `exit()` воркеры не прерывает. [проверь] может завершить главный цикл Qt. | MWG:74-81,132; `3rdparty/QThreadCreateThread.hpp`:19-21 |
| 072 | Сортировка 100000/99999 → только если оба `full_test_report` пусты. Иначе сравнение строк отчётов, порядок нестрогий. | MW:988-1016 |
| 055/111 | Esc = отмена → шлёт `profile_selected(-1)`. Для Front Proxy это очищает выбор. | MW:206-209; `dialog_edit_group.cpp`:98-103 |
| 205/041 | Область по подменю → есть третий режим: хоткей или меню закрыто = выделение, иначе вся группа. Режим «залипает» на 200 мс. | MW:369-371,1470-1480 |
| 223 | «Включение только при Mixed-порту» → защиты нет. | MW:717-738; QPC:235-243 |
| 149 | Document → просто messagebox с URL. Format считает `{}` невалидным. | DMR:43-50 |
| 196 | «Две кнопки» → в буфер сразу ложится третий вариант (export) до выбора. Коды возврата 2/3 против индекса custom-кнопок [проверь]. | MW:1211-1230 |
| 109 | URL обязателен → проверка только у существующих групп. | `dialog_edit_group.cpp`:74-79 |

## 3. Сознательные отказы

- **Qt-механика** (заменить нативными решениями): FR-UI-019, 029, 041 (перенос пунктов меню; семантику scope сохранить), 057, 059, 061, 073, 076, 087, 089; FR-UI-166/240 (QSS, QStyleFactory, хак палитры `qss.mid(20,7)` в `ui/ThemeManager.cpp`:46); FR-UI-167, 238, 239, 241; FR-UI-228/229 — требование оставить, реализацию нет.
- **Внешние ядра** (ядро только sing-box; в форке есть native `protocol/{hysteria2,tuic,naive}`): FR-UI-095, 099, 175, 233-235, 145 (автобайпас), поля «Force use external core» в 096/097, 183 (`need_keep_vpn_off`); каталог `temp/` с конфигами внешних ядер чистится только при старте (`main/main.cpp`:114).
- **Внешний TUN (два процесса, root-helper):** FR-UI-180-183 и часть 185. Шаблон `res/vpn/sing-box-vpn.json`:95 содержит outbound `dns`; в реестре форка `dns` не зарегистрирован (`sing-box/include/registry.go`:80-102; `docs/deprecated.md`:95-100 — «removed in 1.13.0») [проверь запуском]. Остановка идёт по имени образа (LNB-09). На Linux «Reset» делает `pkexec killall -2 nekobox_core`, то есть убивает и собственное ядро приложения (MW:1837).
- **Мёртвое или устаревшее:** FR-UI-131, 148 (Direct strategy, Final DNS Out), третий режим sniffing; FR-UI-169/213/254 (Connections — заглушка до реализации); FR-UI-248 (`-flag_reorder`); FR-UI-236 (5-секундная модалка → таймауты); FR-UI-002/003 (апстримные Document/Ads); FR-UI-060 (заглушка дашборда → кнопка «Open dashboard»); FR-UI-224 macOS LoginItems (deprecated API).

## 4. Скрытые находки, достойные переноса

1. **Знак числа как флаг включения.** `-9090`, `-30` и макросы `D_LOAD/SAVE_INT_ENABLE` дают «выключено, но значение помнится» (`main/GuiUtils.hpp`:56-70; `NekoGui_DataStore.hpp`:124,164). В BUGS упомянут только `-9090`. Переносить как пару `{enabled,value}`.
2. **Single-instance.** Ключ — путь каталога конфига, поэтому разные `-appdata` живут параллельно; имя локального сокета лежит в shared memory; есть лечение «зависшей» shm на *nix (`main/main.cpp`:125-146; `3rdparty/RunGuard.hpp`:46-50). В Tauri ключ нужен по data-dir.
3. **Область действия.** Один набор действий для меню и хоткеев: «выделение, иначе вся группа» плюс 200 мс залипания (MW:369-371,1470-1480).
4. **Самолечение старта.** Ядро не слушает — рестарт и отложенный старт. Любой старт сначала гасит текущий профиль (MWG:363-386).
5. **Зеркалирование жизни helper-а.** Выход elevated-процесса сам выключает переключатель Tun в UI (MW:1794-1805). Нужно и для нового TUN-helper (ср. LNB-21).
6. **Linux elevation.** `setcap` по realpath, `getcap` как критерий IsAdmin, проба `pkexec --help` (`main/NekoGui.cpp`:435-460; `sys/linux/LinuxCap.cpp`:27-35).
7. **Мелочи.** `MyLineEdit::setText` ставит курсор в начало (длинные UUID/URL показывают начало); «Save as route» предвыбирает IP или Domain (MW:1579); цепочка иконки: встроенная → `../nekobox.png` → `./nekobox.png` (`ui/Icon.cpp`:8-17).

## 5. Мёртвый код и настройки

- `menu_copy_link` («Copy Link») объявлен в `ui/mainwindow.ui`:672. Нет `addaction`, нет слота.
- `title_error` не присваивается (MW:857).
- Настройки `routing->domain_strategy`, `dns_final_out`, `direct_dns_strategy`: читаются и пишутся UI (DMR:143,150-151,165,173-174), но ConfigBuilder их не использует.
- Режим sniffing «for destination» эквивалентен «for routing» (CB:734).
- Connection statistics: чекбокс принудительно disabled (DBS:96); `enable_nekoray_connections` (MWG:312) ядром не читается; `ListConnections` — заглушка.
- PAC-ветка `__SetProxyOptions(..., isPAC)` вызывается только с `false` (QPC:154-169,269).
- Скрытое поле `reality_spx` (DEP:93-94).
- Остатки V2Ray-ядра: `CoreType::V2RAY "DO NOT USE"`, `DomainMatcher` (`main/Const.hpp`:5-21), switch `coreType` (`main/main.cpp`:179-186), подсказка «For V2Ray…» у Domain Strategy.
- Устаревшие geo-ресурсы: `geoip.db/geosite.db` (`libs/build_public_res.sh`:12-13); Linux-пути `sing-geoip/sing-geosite` (`main/NekoGui.cpp`:420-422); ядро 1.14 их не использует, `.dat` нужны только автодополнению.
- В `StopVPNProcess`: холостой `core_process->processId();` (MW:1824). В `StartVPNProcess`: `vpn_pid = 1; // TODO` (MW:1790).

## 6. Юзабилити для редизайна

1. **Клавиатура.** Нестандартные привязки: Ctrl+S = Stop, Ctrl+Q = QR (не Quit), Ctrl+N = Copy Neko links, Ctrl+C/A/V переопределены (`ui/mainwindow.ui`:621-924). Enter в поле поиска может запускать профиль: `Return` — window-shortcut [проверь].
2. **Доступность.** В UI нет `accessibleName`, `buddy` только один (`dialog_manage_routes.ui`:239); `tabstop` отсутствует в mainwindow, basic_settings и manage_groups; в `mainwindow.ui` нет ни одного toolTip. Статусы только цветом: бейдж трея (`ui/Icon.cpp`:32-39), латентность (`db/Database.cpp`:237-245). Drag-and-drop строки таблицы двигает только `currentRow()` (`ui/widget/MyTableWidget.h`, dropEvent).
3. **Немодальные диалоги.** Тема, Inbound Auth, Core Options и sp_format применяются сразу и не откатываются кнопкой Cancel (DBS:89,133-144,348-353,402-408). Смена языка поднимает флаг «нужен рестарт» даже после возврата к исходному значению (DBS:118-120).
4. **Деструктив без undo.** Remove Duplicates использует ключ «адрес+тип» (MW:1373; `db/ProfileFilter.cpp`:5-6): удалит разные профили на одном host:port с разными uuid/SNI. Сортировка затирает ручной порядок (MW:1021). Apply-to-group без счётчика (DEP:441-477); `sub_clear`; Remove group удаляет все профили. Delete запущенного профиля молча пропускается (`db/Database.cpp`:277).
5. **Тихие no-op.** Обновление не-подписочной группы (MW:1399); старт и тест в archive-группе (MWG:71,300); Debug, QR и Export при мульти-выделении (MW:1168,1207,1235); второй диалог настроек (MW:599) и конфликт хоткеев (MW:1739).
6. **Результат клика по статус-метке** живёт ≤ 2–4 с: `last_test_time` и таймер 2 с (MW:834; MWG:249-274).
7. **Фильтр поиска.** `setRowHidden` скрывает строки, но `selectAll` + Delete/Move могут затронуть скрытые [проверь] (MW:212-226,1366).
8. **Секреты на виду.** Debug Info показывает весь JSON с секретами (MW:1169); результат QR-скана пишется в лог (MW:1340); поля паролей без echoMode — уже U-11.
9. **Локализация.** ru_RU: 410 строк, 9 unfinished, среди них видимые «URL Test», «Stop Testing», «Final DNS Out», «Mixed (SOCKS+HTTP) Listen Port». fa_IR: 183 из 391 unfinished; zh_CN: 0. `qtbase_ru` не поставляется: `libs/deploy_windows64.sh`:15 удаляет `translations`, в `res/public` только `qtbase_zh_CN.qm` — стандартные Yes/No и файловые диалоги остаются английскими. Захардкоженные английские строки: MW:748,756,758; MWG:304,321,352,357,366,442; DEP:190,382; DMR:49 («invaild json»).
10. **Мелкие аффордансы.** Выбор «As Subscription…» и Move сделаны через combo в `QInputDialog` с сырым id (MW:1128-1135; `sub/GroupUpdater.cpp`:491-505). Inline-переименования нет (`NoEditTriggers`).

## Не проверено

Реальное поведение Qt (коды возврата `QMessageBox::exec` для custom-кнопок, `QThread::exit()` у GUI-потока, `selectAll` и скрытые строки, Enter в `QLineEdit` при window-shortcut); запуск `nekobox_core check` на шаблоне внешнего TUN; macOS- и Linux-ветки (только код); `sub/`, `db/traffic`, `rpc/` — вне этой половины; полнота перевода — по счётчикам `.ts`.
