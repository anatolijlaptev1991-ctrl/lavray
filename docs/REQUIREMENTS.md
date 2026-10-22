# LAVRay — Каталог функциональных требований UI (реверс-инжиниринг NekoBox)

> Источник: форк `nekoray` (ветка `feature/singbox-upgrade`, Qt 6.7.2 / C++ + Go-ядро nekobox_core с sing-box).
> Цель: полный реестр функций UI/UX, которые должны быть воспроизведены (или осознанно отброшены) в LAVRay (Rust/Tauri + React + Go-ядро).
> Приоритеты: **MUST** — ядро функциональности, потеря = регресс для пользователя; **NICE** — желательно/доп. удобство.
> Пути файлов указаны относительно `D:/ZCode/nekobox/nekoray/`.

---

## Оглавление разделов

1. [Главное окно](#1-главное-окно)
2. [Таблица профилей и вкладки групп](#2-таблица-профилей-и-вкладки-групп)
3. [Редактор профиля](#3-редактор-профиля)
4. [Группы](#4-группы)
5. [Подписки](#5-подписки)
6. [Маршрутизация](#6-маршрутизация)
7. [DNS](#7-dns)
8. [Базовые настройки](#8-базовые-настройки)
9. [TUN / VPN](#9-tun--vpn)
10. [Горячие клавиши](#10-горячие-клавиши)
11. [Импорт / экспорт / шаринг / QR / happ](#11-импорт--экспорт--шаринг--qr--happ)
12. [Тесты соединения](#12-тесты-соединения)
13. [Статистика трафика и список соединений](#13-статистика-трафика-и-список-соединений)
14. [Логи](#14-логи)
15. [Системная интеграция (трей, прокси ОС, автозапуск, процессы)](#15-системная-интеграция)
16. [Локализация, темы, иконки](#16-локализация-темы-иконки)
17. [Модель данных и хранение](#17-модель-данных-и-хранение)
18. [Контракт UI ↔ ядро (gRPC/процессы)](#18-контракт-ui--ядро)
19. [Таблица «фича → файл-источник»](#19-таблица-фича--файл-источник)
20. [UX-проблемы текущего NekoBox](#20-ux-проблемы-текущего-nekobox-рекомендации-для-lavray)

---

## 1. Главное окно

### 1.1. Верхняя панель (toolbar)

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-001 | Панель инструментов | Слева направо: кнопки-меню «Program», «Preferences», «Server» (иконка+текст под иконкой, мгновенный popup), кнопки «Ads», «Document», «Update»; справа чекбоксы «Tun Mode» и «System Proxy»; поле поиска; кнопка «URL Test». | `ui/mainwindow.ui` | MUST |
| FR-UI-002 | Кнопка Document | Открывает `https://matsuridayo.github.io/` во внешнем браузере. | `ui/mainwindow.cpp:104` | NICE |
| FR-UI-003 | Кнопка Ads | Открывает `https://neko-box.pages.dev/喵` во внешнем браузере. | `ui/mainwindow.cpp:105` | NICE |
| FR-UI-004 | Кнопка Update | Запускает проверку обновлений в фоне (см. FR-UI-230). | `ui/mainwindow.cpp:106` | MUST |
| FR-UI-005 | Кнопка URL Test | Запускает URL-тест всей текущей группы (`speedtest_current_group(1, true)`). | `ui/mainwindow.cpp:107` | MUST |
| FR-UI-006 | Чекбокс Tun Mode | Вкл/выкл TUN (см. FR-UI-178–186). | `ui/mainwindow.cpp:324` | MUST |
| FR-UI-007 | Чекбокс System Proxy | Вкл/выкл системный прокси (см. FR-UI-221–223). | `ui/mainwindow.cpp:325` | MUST |
| FR-UI-008 | Строка поиска | Скрыта по умолчанию; Ctrl+F показывает и фокусирует; фильтрует строки таблицы по вхождению (MatchContains) в любом столбце; очистка показывает все строки. | `ui/mainwindow.cpp:194–226` | MUST |

### 1.2. Меню Program (оно же — меню трея)

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-009 | Show Window | Показать/скрыть окно (аналог клика по трею). | `ui/mainwindow.ui`, `mainwindow.cpp:252` | MUST |
| FR-UI-010 | Add profile from clipboard | Импорт содержимого буфера обмена через GroupUpdater (FR-UI-114). | `mainwindow.cpp:249` | MUST |
| FR-UI-011 | Scan QR Code | Скриншот экрана → распознавание QR → импорт (FR-UI-195). | `mainwindow.cpp:1317–1344` | NICE |
| FR-UI-012 | Decrypt Happ link | Открывает диалог расшифровки happ:// (FR-UI-198). | `mainwindow.cpp:1346` | MUST (для RU-аудитории) |
| FR-UI-013 | Start with system | Чекбокс; состояние синхронизировано с реальным автозапуском ОС (FR-UI-224). | `mainwindow.cpp:254–256, 316` | MUST |
| FR-UI-014 | Remember last profile | Чекбокс «запоминать последний профиль»: при старте программы автоматически запускается последний профиль. | `mainwindow.cpp:312, 405–407` | MUST |
| FR-UI-015 | Allow other devices to connect | Чекбокс; переключает listen inbound между `127.0.0.1` и `::` (доступ по LAN); требует сохранения datastore. | `mainwindow.cpp:257, 319–322` | MUST |
| FR-UI-016 | Active Server (подменю) | Динамически строится из профилей текущей группы (лимит 100 шт.), чекбокс у запущенного; клик = start, клик по запущенному = stop. | `mainwindow.cpp:258–293` | MUST |
| FR-UI-017 | Active Routing (подменю) | Список сохранённых наборов маршрутов (файлы в `routes/`), текущий отмечен; выбор → подтверждение с превью правил → применение (+ рестарт прокси, если запущен). | `mainwindow.cpp:273–311`, `main/NekoGui.cpp:363–378` | MUST |
| FR-UI-018 | System Proxy (подменю режима) | Три пункта-«радио»: Enable System Proxy / Enable Tun / Disable; состояние отражается при открытии. | `mainwindow.ui:477–484`, `mainwindow.cpp:326–336` | MUST |
| FR-UI-019 | Preferences (подменю) | Дублирует меню Preferences (см. FR-UI-020). | `mainwindow.cpp:248` | NICE |
| FR-UI-020 | Restart Proxy | Перезапуск текущего профиля (`neko_start(started_id)`), если что-то запущено. | `mainwindow.cpp:250` | MUST |
| FR-UI-021 | Restart Program | Полный перезапуск приложения (сохранение состояния, повторный запуск процесса; поддержка launcher-режима). | `mainwindow.cpp:251, 651–711` | MUST |
| FR-UI-022 | Exit | Корректный выход: снять системный прокси и TUN, сохранить datastore/менеджер, остановить ядро, скрыть трей, завершить процесс. | `mainwindow.cpp:651–711` | MUST |

### 1.3. Меню Preferences

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-023 | Groups | Открывает диалог управления группами (FR-UI-102). | `ui/mainwindow.ui:520–530`, `mainwindow.cpp:612` | MUST |
| FR-UI-024 | Basic Settings | Открывает базовые настройки (FR-UI-156–177). | `mainwindow.cpp:608` | MUST |
| FR-UI-025 | Routing Settings | Открывает редактор маршрутов (FR-UI-130–147). | `mainwindow.cpp:616` | MUST |
| FR-UI-026 | Tun Settings | Открывает настройки TUN (FR-UI-178). | `mainwindow.cpp:620` | MUST |
| FR-UI-027 | Hotkey Settings | Открывает настройки горячих клавиш (FR-UI-187). | `mainwindow.cpp:624` | NICE |
| FR-UI-028 | Open Config Folder | Открывает текущий рабочий каталог конфигурации в файловом менеджере ОС. | `mainwindow.cpp:247` | MUST |
| FR-UI-029 | Защита от повторного открытия диалога | Одновременно может быть открыт только один экземпляр каждого диалога настроек (`USE_DIALOG`). | `mainwindow.cpp:596–606` | MUST |

### 1.4. Меню Server (контекстное меню таблицы профилей)

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-030 | New profile | Открывает редактор нового профиля (тип по умолчанию `socks`) в текущей группе. | `mainwindow.cpp:1095–1098` | MUST |
| FR-UI-031 | Add profile from clipboard (Ctrl+V) | Импорт из буфера обмена. | `mainwindow.cpp:1100–1103` | MUST |
| FR-UI-032 | Start (Return) | Запуск первого выделенного профиля (или выбранного в select-mode). | `mainwindow.cpp:617–623`, `mainwindow_grpc.cpp:285` | MUST |
| FR-UI-033 | Stop (Ctrl+S) | Остановка текущего профиля. | `mainwindow.cpp:625–631` | MUST |
| FR-UI-034 | Select All (Ctrl+A) | Выделить все строки таблицы; если фокус в логе — выделить текст лога. | `mainwindow.cpp:1361–1367` | MUST |
| FR-UI-035 | Move (Ctrl+M) | Перенос выделенных профилей в другую группу через диалог выбора (список «id имя»). | `mainwindow.cpp:1120–1142` | MUST |
| FR-UI-036 | Clone (Ctrl+D) | Клонирование выделенных профилей (через генерацию Neko-ссылок и повторный импорт); с подтверждением количества. | `mainwindow.cpp:1105–1118` | MUST |
| FR-UI-037 | Reset Traffic (Ctrl+R) | Обнуление накопленного трафика выделенных профилей. | `mainwindow.cpp:1156–1164` | MUST |
| FR-UI-038 | Delete (Del) | Удаление выделенных профилей с подтверждением количества; запрещено удаление запущенного. | `mainwindow.cpp:1144–1154`, `db/Database.cpp:276–282` | MUST |
| FR-UI-039 | Debug Info | Просмотр JSON выделенного профиля; кнопки OK / Edit (открыть `profiles/<id>.json` во внешнем редакторе) / Reload (перезагрузить БД с диска). | `mainwindow.cpp:1166–1177` | NICE (важно для поддержки) |
| FR-UI-040 | Подменю Share | QR Code and link (Ctrl+Q), Export config (Ctrl+E), Copy links (Ctrl+C), Copy links Neko (Ctrl+N) — см. раздел 11. | `ui/mainwindow.ui:531–544` | MUST |
| FR-UI-041 | Подменю Current Select / Current Group | Пункты тестирования (Tcp Ping/Url Test/Full Test/Stop Testing/Clear Test Result/Resolve Domain) «переезжают» между подменю «Текущее выделение» и «Текущая группа» в зависимости от того, какое подменю открыли. | `mainwindow.cpp:343–372` | MUST (поведение), NICE (механика переноса) |
| FR-UI-042 | Групповые операции Current Group | Remove Unavailable (Ctrl+Alt+R) — удалить профили с отрицательной латентностью; Remove Duplicates (Ctrl+Alt+D) — дедупликация по адресу+типу с подтверждением и списком (до 20 строк); Update subscription (Ctrl+U). | `mainwindow.cpp:1369–1430`, `db/ProfileFilter.cpp` | MUST |
| FR-UI-043 | Resolve domain (Ctrl+Alt+I) | Резолв домена сервера в IP для выделения/группы: заменяет `serverAddress` на IP, переносит домен в SNI (TLS) и host (ws); пропускает chain/custom/naive и уже-IP. | `mainwindow.cpp:1432–1453`, `fmt/AbstractBean.cpp:44–78` | NICE |

### 1.5. Статус/титул/трей

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-044 | Статусная строка (низ окна) | Слева: состояние «Not Running» либо `[группа] имя профиля` (обрезка 30 симв.); по центру: `Mixed: адрес:порт` inbound; справа: скорости `Proxy: X↑X↓\nDirect: Y↑Y↓`. | `mainwindow.cpp:805–845` | MUST |
| FR-UI-045 | Клик по метке статуса | ЛКМ по метке запущенного профиля = URL-тест текущего (результат показывается в метке «Test Result: N ms / Unavailable»). | `mainwindow.cpp:1626–1642` | NICE |
| FR-UI-046 | Клик по метке inbound | ЛКМ открывает Basic Settings (удобный доступ к порту). | `mainwindow.cpp:1632–1635` | NICE |
| FR-UI-047 | Композиция заголовка окна | `[Admin] [Select] [ошибка] [Tun]/[System Proxy]/[Tun+System Proxy] Имя (версия) [активный маршрут] [тип] имя@группа`. | `mainwindow.cpp:853–868` | MUST |
| FR-UI-048 | Тултип трея | Многострочный аналог заголовка. | `mainwindow.cpp:887–889` | MUST |
| FR-UI-049 | Индикация иконки трея | Угловой бейдж на иконке: зелёный (запущено), синий (System Proxy), красный (TUN); без бейджа — не запущено. Поддержка кастомной иконки `nekobox.png`. | `ui/Icon.cpp:10–45` | MUST |
| FR-UI-050 | Клик по иконке трея | Показать/скрыть окно. | `mainwindow.cpp:236–244` | MUST |
| FR-UI-051 | Меню трея | = меню Program (FR-UI-009–022). | `mainwindow.cpp:232–235` | MUST |
| FR-UI-052 | Закрытие окна | Сворачивание в трей (ignore close event), если трей активен. | `mainwindow.cpp:445–450` | MUST |
| FR-UI-053 | Запуск в трей | Флаг `-tray` или настройка «Hide dashboard at startup»: окно не показывается при старте. | `main/main.cpp:90, 193`, `mainwindow.cpp:442` | MUST |
| FR-UI-054 | Запоминание геометрии | Размер окна (`mw_size`, «WxH») и состояние сплиттера сохраняются при закрытии, восстанавливаются при старте. | `mainwindow.cpp:85–92, 628–649` | MUST |

### 1.6. Жизненный цикл окна/приложения

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-055 | Select mode | Специальный режим «выбор профиля» (используется редактором chain и front proxy группы): метка статуса «Select *», подсказка в тултипе, двойной клик/Enter = выбор, Esc = отмена; после выбора вызывается callback. | `mainwindow.cpp:1645–1651, 846–851` | MUST |
| FR-UI-056 | Второй запуск приложения | RunGuard: вторая инстанция подключается к локальному серверу первой и завершается; первая поднимает окно («Raise»). Флаг `-many` отключает защиту. | `main/main.cpp:120–146, 227–238` | MUST |
| FR-UI-057 | Периодическое обновление UI | Таймер 2 сек — refresh_status; таймер 1 сек — сброс счётчика строк лога (антифлуд). | `mainwindow.cpp:426–432` | MUST |
| FR-UI-058 | Реакция на SIGTERM/SIGINT | Сохранение данных и выход. | `main/main.cpp:21–26, 223–225` | MUST |
| FR-UI-059 | Обработка commitDataRequest (завершение сессии ОС) | Сохранение размера окна, сплиттера, remember_id, datastore, менеджера. | `mainwindow.cpp:628–649` | MUST |
| FR-UI-060 | Каталог dashboard | При первом запуске создаётся `dashboard/index.html` (notice) для external_ui Clash API. | `mainwindow.cpp:94–97` | NICE |
| FR-UI-061 | Диалоги сообщений | Единый механизм `MW_dialog_message(sender, info)` с командами: UpdateIcon, UpdateDataStore(+RouteChanged/NeedRestart/VPNChanged), RestartProgram, Raise, ClearConnectionList, accept/restart от редактора профиля, refresh от менеджера групп, finish/NewGroup от SubUpdater, Crashed/CoreCrashed/CoreStarted от процессов. | `mainwindow.cpp:519–592` | MUST (архитектура событий) |
| FR-UI-062 | Предложение перезапуска прокси | После изменения настроек/профиля, если прокси запущен, — вопрос «Settings changed, restart proxy?» (Yes → перезапуск). | `mainwindow.cpp:536–541, 560–568` | MUST |
| FR-UI-063 | Предупреждение о настройках TUN | Изменение TUN-настроек при активном TUN → предупреждение «Restart Tun to take effect». | `mainwindow.cpp:534–536` | MUST |
| FR-UI-064 | NeedRestart (смена языка/ядра) | Сообщение «Restart the program to take effect» с предложением перезапуска. | `mainwindow.cpp:543–549` | MUST |

---

## 2. Таблица профилей и вкладки групп

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-065 | Колонки таблицы | Type, Address (host:port, IPv6 в скобках), Name, Test Result (латентность с цветом или полный отчёт full test), Traffic (`X↑ Y↓`, пусто если 0). | `ui/mainwindow.ui:287–312`, `mainwindow.cpp:1028–1079` | MUST |
| FR-UI-066 | Вертикальный заголовок | Номер строки; у активного профиля — «✓». | `mainwindow.cpp:1041–1043` | MUST |
| FR-UI-067 | Подсветка активной строки | Строки Type/Address/Name запущенного профиля окрашиваются цветом link-палитры. | `mainwindow.cpp:1048–1061` | MUST |
| FR-UI-068 | Цвета латентности | <0 — красный «Unavailable»; >0 — зелёный (<100 мс для http-URL, <200 мс для https) / жёлтый; 0 — пусто. | `db/Database.cpp:226–249` | MUST |
| FR-UI-069 | Контекстное меню таблицы | ПКМ по таблице = меню Server (FR-UI-030–043). | `mainwindow.cpp:1455–1457` | MUST |
| FR-UI-070 | Двойной клик | Открыть редактор профиля (или выбрать в select mode). | `mainwindow.cpp:1083–1093` | MUST |
| FR-UI-071 | Мультивыделение | Выделение строк (Ctrl/Shift), все операции применяются к выделению (`get_now_selected_list`). | `mainwindow.cpp:1459–1468` | MUST |
| FR-UI-072 | Сортировка по заголовкам | Клик по заголовку Type/Address/Name/Test Result: сортировка строк (латентность: непротестированные = 100000, недоступные = 99999); повторный клик по тому же столбцу — обратный порядок; результат сортировки сохраняется в группе (`save_sort`). | `mainwindow.cpp:154–177, 940–1022` | MUST |
| FR-UI-073 | Сброс порядка | Клик по угловой кнопке таблицы — сброс кастомного порядка к порядку id. | `mainwindow.cpp:150–153` | NICE |
| FR-UI-074 | Drag&Drop строк | Перетаскивание строк мышью; порядок сохраняется в `group->order` и на диск. | `ui/widget/MyTableWidget.h`, `mainwindow.cpp:144–148` | MUST |
| FR-UI-075 | Самокоррекция порядка | Порядок чистится от удалённых профилей, новые профили добавляются без перемещения. | `ui/widget/MyTableWidget.h:update_order` | MUST |
| FR-UI-076 | Ручная ширина колонок (per group) | Флаг группы `manually_column_width`: сохранённые ширины применяются при показе группы; иначе авторазмер (Type/Result/Traffic — по содержимому, Address/Name — Stretch). | `mainwindow.cpp:178–188, 493–507` | NICE |
| FR-UI-077 | Точечное обновление строк | Обновление данных одной строки по id (тесты, трафик) без перерисовки таблицы. | `mainwindow.cpp:1028–1032` | MUST |
| FR-UI-078 | Вкладки групп | QTabWidget: одна вкладка на группу; переключение — показ группы (`show_group`); вкладки перемещаемые (drag), порядок сохраняется (`groupsTabOrder`). | `mainwindow.ui:228–235`, `mainwindow.cpp:71–78, 456–515` | MUST |
| FR-UI-079 | Текущая группа | Запоминается последняя открытая группа (`current_group`), восстанавливается при старте. | `mainwindow.cpp:487–490`, `main/main.cpp` | MUST |
| FR-UI-080 | Автоскролл к активному | При показе группы выполняется скролл к запущенному профилю. | `mainwindow.cpp:510–512` | NICE |

---

## 3. Редактор профиля

Общие файлы: `ui/edit/dialog_edit_profile.cpp/.ui`, `ui/edit/profile_editor.h`, бины в `fmt/*Bean.hpp`.

### 3.1. Каркас редактора

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-081 | Список типов нового профиля | socks, http, shadowsocks, trojan, vmess, vless, naive, hysteria2, tuic, «Custom (sing-box outbound)» (internal), «Custom (sing-box config)» (internal-full), «Custom (Extra Core)» (custom), chain. | `dialog_edit_profile.cpp:109–123` | MUST |
| FR-UI-082 | Смена типа до сохранения | Для нового профиля можно переключать тип; для существующего тип фиксирован (скрыт). | `dialog_edit_profile.cpp:125–136` | MUST |
| FR-UI-083 | Общие поля | Name, Address, Port (порт — только цифры; адрес — пробелы вырезаются при сохранении). Скрыты для chain и internal/internal-full. | `dialog_edit_profile.cpp:200–204, 269–272, 338–341` | MUST |
| FR-UI-084 | Custom Outbound Settings | JSON-редактор (структурированный, с проверкой); содержимое глубокo мержится в исходящий outbound конкретного профиля. Кнопка-индикатор «Not set / Already set». | `dialog_edit_profile.cpp:235–250, 422–425`, `db/ConfigBuilder.cpp:363` | MUST |
| FR-UI-085 | Custom Config Settings | JSON-редактор; мержится в корень всего конфига ядра (правила слияния массивов: ключи `+key`/`key+` = конкатенация). | `db/ConfigBuilder.cpp:32–68, 89`, `dialog_edit_profile.cpp:427–430` | MUST |
| FR-UI-086 | Apply settings to this group | Кнопка включает режим: у полей multiplex, SNI, ALPN, Host, Path, uTLS, Allow insecure, Certificate, Custom Config, Custom Outbound появляются «плавающие» чекбоксы; подтверждение копирует отмеченные поля во все профили группы. | `dialog_edit_profile.cpp:441–523`, `ui/widget/FloatCheckBox.h` | NICE (мощно, но опционально) |
| FR-UI-087 | Динамический размер диалога | Диалог подстраивает размер под выбранный тип; позиционируется относительно главного окна. | `dialog_edit_profile.cpp:21, 323` | NICE |
| FR-UI-088 | Сохранение | Новый профиль → AddProfile в текущую группу; существующий → Save; если изменён запущенный профиль — предложение перезапуска. | `dialog_edit_profile.cpp:370–391` | MUST |
| FR-UI-089 | Маркировка «продвинутых» полей | Поля с tooltip получают суффикс «*» (ADD_ASTERISK). | `main/GuiUtils.hpp:118–133` | NICE |

### 3.2. Настройки транспорта (V2Ray Stream Settings, правая часть редактора)

Применимо к socks/http/ss/vmess/vless/trojan. Источник: `fmt/V2RayStreamSettings.hpp`, `dialog_edit_profile.cpp/.ui`.

| ID | Название | Поведение | Приоритет |
|----|----------|-----------|-----------|
| FR-UI-090a | Network | Комбо: tcp, http, ws, grpc, httpupgrade (видимость — только vmess/vless/trojan). Заголовок группы «Network Settings (%1)». | MUST |
| FR-UI-090b | Поля транспорта по сети | tcp: header_type (none/http) + path + host; grpc: path; ws/http/httpupgrade: path + host; прочие: ничего. | MUST |
| FR-UI-090c | WS Early Data | Для ws: имя заголовка и длина early data (`ws_early_data_name/length`). | NICE |
| FR-UI-090d | Security | Комбо: (пусто)/tls/reality — видимость для vmess/vless/trojan/http. При tls/reality показывается блок TLS. | MUST |
| FR-UI-090e | TLS: SNI, ALPN | SNI — «server name indication»; ALPN — через запятую. | MUST |
| FR-UI-090f | Allow insecure | Не проверять сертификат сервера. | MUST |
| FR-UI-090g | Certificate | Клиентский сертификат (многострочный ввод). | NICE |
| FR-UI-090h | uTLS Fingerprint | Комбо: chrome, firefox, edge, safari, 360, qq, ios, android, random, randomized (по умолчанию — из глобальных настроек). | MUST |
| FR-UI-090i | REALITY | reality_pbk (public key — включает REALITY, если непусто), reality_sid (short id). | MUST |
| FR-UI-090j | Packet Encoding | Для vmess/vless: (пусто)/packetaddr/xudp (UDP FullCone). | MUST |
| FR-UI-090k | Multiplex | Для vmess/vless/trojan/ss: Keep Default / On / Off; глобальные параметры mux (протокол, padding, concurrency, default on) из настроек. | MUST |
| FR-UI-090l | Видимость блоков | Блок Settings скрывается, если для типа нет ни transport, ни security, ни mux. | MUST |

### 3.3. Поля по типам

| ID | Тип | Поля | Источник | Приоритет |
|----|-----|------|----------|-----------|
| FR-UI-091 | SOCKS / HTTP | Version (Socks4/Socks5 или HTTP), Username, Password + stream settings. | `fmt/SocksHttpBean.hpp`, `ui/edit/edit_socks_http.*` | MUST |
| FR-UI-092 | Shadowsocks | Encryption (пресет: 2022-blake3-* , none, aes-*-gcm/ctr/cfb, chacha20*, xchacha20*, rc4-md5), Password, Plugin (строка «plugin;arg=val;…»), Plugin Args, UDP over TCP (Off/версия 1/2). | `fmt/ShadowSocksBean.hpp`, `ui/edit/edit_shadowsocks.*`, `fmt/Preset.hpp` | MUST |
| FR-UI-093 | VMess | UUID + кнопка Generate UUID, Alter Id, Security (auto/…). | `fmt/VMessBean.hpp`, `ui/edit/edit_vmess.*` | MUST |
| FR-UI-094 | Trojan / VLESS | Password (у VLESS — UUID), Flow (xtls-rprx-vision). | `fmt/TrojanVLESSBean.hpp`, `ui/edit/edit_trojan_vless.*` | MUST |
| FR-UI-095 | Naive (внешнее ядро) | Username, Password, Protocol (https/http), Extra headers, SNI, Certificate, Insecure concurrency, Disable logs («если соединение рвётся через время»). | `fmt/NaiveBean.hpp`, `ui/edit/edit_naive.*` | NICE |
| FR-UI-096 | Hysteria2 | Password, Obfs Password, Upload/Download (Mbps), Hop Port (диапазон портов, меняет отображение адреса), Hop Interval (с), Force use external core, TLS: SNI, CA-сертификат, Allow Insecure, Disable SNI. (Поля uuid/congestion/udpRelayMode/zeroRtt/heartbeat/uos/alpn/disableMtuDiscovery/receive-windows скрыты для hy2.) | `fmt/QUICBean.hpp`, `ui/edit/edit_quic.*` | MUST |
| FR-UI-097 | TUIC | UUID (+Generate), Password, Congestion Control (bbr/cubic/new_reno), UDP Relay Mode (native/quic), Zero Rtt Handshake, Heartbeat (напр. «10s»), TLS-блок как у hy2 (SNI/ALPN/CA/insecure/disableSni), Force use external core. Примечание: поле `uos` (udp-over-stream) существует в модели и импортируется из Clash, но в редакторе этого форка скрыто. | `fmt/QUICBean.hpp`, `ui/edit/edit_quic.*` | MUST |
| FR-UI-098 | Chain Proxy | Упорядоченный список профилей (порядок сверху вниз = порядок трафика); «Select Profile» через select mode; у каждого элемента — замена (change) и удаление; запрет chain-in-chain (валидация при сборке); имя обязательно. | `fmt/ChainBean.hpp`, `ui/edit/edit_chain.*`, `db/ConfigBuilder.cpp:94–148` | MUST |
| FR-UI-099 | Custom (Extra Core) | Core (комбо из ExtraCore-карты), Command (строка, разбивается по пробелам), Config Suffix, Config (текст; плейсхолдеры `%mapping_port%`, `%socks_port%`, `%server_addr%`, `%server_port%`; 0/пусто = случайный порт), Mapping Port, Socks Port, «as JSON» редактор, Preview (показ подстановок + итоговая команда и конфиг внешнего ядра, кнопка Copy). | `fmt/CustomBean.hpp`, `ui/edit/edit_custom.*` | NICE |
| FR-UI-100a | Custom internal (sing-box outbound) | JSON одного outbound (тип определяется по полю `type`); адрес/порт читаются из JSON. | `fmt/CustomBean.hpp` | MUST |
| FR-UI-100b | Custom internal-full (sing-box config) | Полный конфиг sing-box, используется «как есть» вместо сгенерированного. | `db/ConfigBuilder.cpp:81–84` | MUST |
| FR-UI-101 | Валидации редактора | Имя обязательно для chain/custom; core обязателен для custom; порт — числовое поле. | `edit_chain.cpp:29`, `edit_custom.cpp:105–115` | MUST |

---

## 4. Группы

Файлы: `ui/dialog_manage_groups.*`, `ui/edit/dialog_edit_group.*`, `ui/widget/GroupItem.*`, `db/Group.hpp`.

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-102 | Диалог «Groups» | Список карточек групп в порядке вкладок; кнопки «New group», «Update all subscriptions». | `ui/dialog_manage_groups.ui/.cpp` | MUST |
| FR-UI-103 | Карточка группы (GroupItem) | Имя; тип «Basic»/«Subscription» (+«Archive», +счётчик профилей); URL (для подписок); строка инфо «Last update: … | Used: X Remain: Y Expire: Z»; кнопки: Update sub, Edit, Remove. | `ui/widget/GroupItem.cpp:36–95` | MUST |
| FR-UI-104 | Парсинг Subscription-UserInfo | Из заголовка ответа `Subscription-UserInfo: upload=…; download=…; total=…; expire=…` → «Used / Remain / Expire» (человекочитаемые размеры и дата). | `ui/widget/GroupItem.cpp:10–37` | MUST |
| FR-UI-105 | Двойной клик по карточке | Открыть редактор группы. | `dialog_manage_groups.cpp:31–34` | MUST |
| FR-UI-106 | New group | Создание группы через редактор; после OK группа добавляется в конец вкладок. | `dialog_manage_groups.cpp:41–52` | MUST |
| FR-UI-107 | Remove group | Подтверждение; нельзя удалить последнюю группу; удаляются и все её профили; обновляются вкладки. | `GroupItem.cpp:97–110`, `db/Database.cpp:350–363` | MUST |
| FR-UI-108 | Update all subscriptions | Подтверждение «Update all subscriptions?» → последовательное (serial) обновление всех групп-подписок, не помеченных skip_auto_update и archive. | `dialog_manage_groups.cpp:54–58`, `sub/GroupUpdater.cpp:644–686` | MUST |
| FR-UI-109 | Редактор группы: тип | Комбо Basic / Subscription: переключает видимость блока подписки; после создания тип менять нельзя; при наличии URL поле URL обязательно. | `ui/edit/dialog_edit_group.cpp:15–26, 74–79` | MUST |
| FR-UI-110 | Поля группы | Name; URL; Archive (заморозка: не тестируется, не обновляется, нельзя запускать профили); Skip automatic update; Manually column width. | `dialog_edit_group.cpp:80–86` | MUST |
| FR-UI-111 | Front Proxy группы | Выбор профиля-«фронта» через select mode + Clear; отображается «None» либо `[тип] имя`; фронт добавляется в конец каждой цепочки профилей группы при сборке конфига. | `dialog_edit_group.cpp:40–45, 89–104`, `db/ConfigBuilder.cpp:127–135` | MUST |
| FR-UI-112 | Share группы | «Copy profile share links» / «(Neko Links)» — экспорт всех профилей группы в буфер. | `dialog_edit_group.cpp:47–64` | MUST |
| FR-UI-113 | Отображение порядка | Порядок групп = порядок вкладок (drag вкладок главного окна). | `mainwindow.cpp:71–78` | MUST |

---

## 5. Подписки

Файлы: `sub/GroupUpdater.cpp/.hpp`, `main/HTTPRequestHelper.cpp`.

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-114 | Единая точка импорта | `AsyncUpdate(контент, gid=-1)`: буфер обмена, QR, happ-расшифровка, ручной ввод — всё через один механизм. | `sub/GroupUpdater.cpp:466–521` | MUST |
| FR-UI-115 | Авто-распознавание URL | Если контент — http(s) URL и группа не указана: диалог с 3 вариантами: «As Subscription (add to this group)», «As Subscription (create new group)», «As link». | `GroupUpdater.cpp:491–505` | MUST |
| FR-UI-116 | Создание группы по подписке | Новая группа именуется по хосту URL; вкладки обновляются. | `GroupUpdater.cpp:508–516` | MUST |
| FR-UI-117 | Загрузка подписки | HTTP GET: UA из настроек (default `NekoBox/PC/<ver> (Prefer ClashMeta Format)`); опционально через локальный прокси (sub_use_proxy); игнор TLS-ошибок (sub_insecure); таймаут 10 сек; лог «>>>>>>> Requesting subscription …». | `main/HTTPRequestHelper.cpp:14–90`, `GroupUpdater.cpp:537–551` | MUST |
| FR-UI-118 | Заголовок Subscription-UserInfo | Сохраняется в `group->info`, отображается в карточке группы. | `GroupUpdater.cpp:548`, `GroupItem.cpp:38–58` | MUST |
| FR-UI-119 | Поддерживаемые форматы контента | (а) Base64-строка → декодирование и рекурсивный разбор; (б) Clash/Clash.Meta YAML (`proxies:`); (в) многострочный текст — построчно; (г) одиночная ссылка. | `GroupUpdater.cpp:38–58` | MUST |
| FR-UI-120 | Поддерживаемые схемы ссылок | `nekoray://`, `socks5://`, `socks4://`, `socks4a://`, `socks://`, `http://`, `https://`, `ss://`, `vmess://`, `vless://`, `trojan://`, `naive+*`, `hysteria2://`, `hy2://`, `tuic://`. | `GroupUpdater.cpp:63–141`, `fmt/Link2Bean.cpp` | MUST |
| FR-UI-121 | Импорт Clash YAML | Типы: ss/ssr, socks5, http, trojan, vless, vmess, hysteria2, tuic. Маппинг: cipher/password/udp-over-tcp(+version)/плагины obfs и v2ray-plugin/smux; flow, packet-addr; sni/servername, alpn, skip-cert-verify, client-fingerprint; ws-opts (headers.host, path, max-early-data, early-data-header-name, в т.ч. Xray-стиль `?ed=` в path), grpc-opts, h2-opts, http-opts; reality-opts (public-key/short-id); hysteria2: ports, up/down, obfs-password, ca-str; tuic: uuid, password, heartbeat-interval, udp-relay-mode, congestion-controller, disable-sni, reduce-rtt, alpn, udp-over-stream, ip-подстановка. | `GroupUpdater.cpp:215–463` | MUST |
| FR-UI-122 | Нормализация после импорта | security none/0/false → «»; 1/true → tls; если адрес — IP и задан host, host переносится в SNI. | `GroupUpdater.cpp:22–36` | MUST |
| FR-UI-123 | Diff-обновление подписки | Без «Clear servers»: сравнение до/после по ключу (JSON без custom полей + тип; для custom — по адресу); лог «Added N profiles: [+] … Deleted M Profiles: [-] …» либо «Nothing»; порядок группы = порядок из ответа; профили, отсутствующие в ответе, удаляются. | `GroupUpdater.cpp:580–636`, `db/ProfileFilter.cpp` | MUST |
| FR-UI-124 | Режим Clear servers | Настройка sub_clear: перед импортом удалить все профили группы; лог со списком «[+]». | `GroupUpdater.cpp:569–575, 585–590` | MUST |
| FR-UI-125 | Обновление вручную | Ctrl+U / кнопка на карточке: обновить конкретную группу; защита от параллельного обновления (`mw_sub_updating`). | `mainwindow.cpp:1395–1403`, `GroupItem.cpp:92–94` | MUST |
| FR-UI-126 | Автообновление | Настройка «Automatic update» + интервал (минуты; <30 = выключено); таймер обновляет все подходящие группы (skip_auto_update/archive учитываются). | `mainwindow.cpp:434–440`, `dialog_basic_settings.cpp:256–260` | MUST |
| FR-UI-127 | Учёт времени обновления | `sub_last_update` сохраняется и показывается в карточке. | `GroupUpdater.cpp:564`, `GroupItem.cpp:44–47` | MUST |
| FR-UI-128 | Happ-ссылки в подписках | Контент `happ://crypt…` расшифровывается в фоне (через nekobox_core) и уходит в обычный поток импорта; ошибки — в диалог. | `GroupUpdater.cpp:472–489`, `main/HappLink.cpp` | MUST (для RU) |
| FR-UI-129 | Счётчик импорта | После импорта не-подписки в лог пишется «Imported N profile(s)». | `mainwindow.cpp:574–579` | MUST |

---

## 6. Маршрутизация

Файлы: `ui/dialog_manage_routes.*`, `main/NekoGui.cpp:311–378`, `db/ConfigBuilder.cpp:456–756`.

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-130 | Диалог Routing Settings | Заголовок содержит активный набор: «Routes [Default]». Вкладки/блоки: Common, Simple Route, DNS, Custom Route. | `ui/dialog_manage_routes.ui/.cpp` | MUST |
| FR-UI-131 | Common: Domain Strategy | Комбо: «», ipv4_only, ipv6_only, prefer_ipv4, prefer_ipv6 (стратегия разрешения доменов). | `dialog_manage_routes.cpp:26–28` | MUST |
| FR-UI-132 | Common: Sniffing Mode | Комбо: Disable / Sniff result for routing / Sniff result for destination. | `dialog_manage_routes.ui`, `main/Const.hpp` | MUST |
| FR-UI-133 | Common: Server Address Strategy | Outbound domain strategy (та же комбо) — применяется к исходящим. | `dialog_manage_routes.cpp:143–144` | MUST |
| FR-UI-134 | Simple Route: 6 полей | Матрица Proxy/Direct/Block × Domain/IP — многострочные редакторы с автодополнением: domain-поля предлагают `geosite:*` из geosite.dat, IP-поля — `geoip:*` из geoip.dat. | `dialog_manage_routes.cpp:62–85` | MUST |
| FR-UI-135 | Синтаксис правил | Построчно; `#` — комментарий; префиксы `geosite:`, `geoip:`, `domain:`, `full:`, `keyword:`, `regexp:`; без префикса — домен-суффикс; IP — CIDR. | `db/ConfigBuilder.cpp:481–531`, `NekoGui_Utils` | MUST |
| FR-UI-136 | Пресеты | Кнопка-меню Preset: «Bypass LAN and China» (direct: geoip:cn+private, geosite:cn; block: geosite:category-ads-all + 3 домена) и «Global». | `dialog_manage_routes.cpp:113–124`, `NekoGui.cpp:312–326` | MUST |
| FR-UI-137 | Custom Route (на набор) | JSON-редактор массива `rules` sing-box; добавляется к сгенерированным правилам. | `dialog_manage_routes.cpp:55–59`, `ConfigBuilder.cpp:730–732` | MUST |
| FR-UI-138 | Custom Route (global) | Аналогичный JSON, применяется к любому активному набору (хранится в datastore). | `dialog_manage_routes.ui`, `ConfigBuilder.cpp:732` | MUST |
| FR-UI-139 | Default Outbound | Комбо итогового outbound: proxy / direct / block (map на теги). | `dialog_manage_routes.cpp:137, 160` | MUST |
| FR-UI-140 | Управление наборами маршрутов | Диалог Load/Save: список файлов `routes/*`, поле имени, кнопки Load / Save / Remove / Cancel; Load и Save — с подтверждением и текстовым превью правил (DisplayRouting); Remove недоступен для последнего набора; при удалении активного — активным становится первый. | `dialog_manage_routes.cpp:177–251` | MUST |
| FR-UI-141 | Активный набор | `active_routing` в datastore; диалог сохраняет отредактированный набор под этим именем; смена набора (меню или диалог) генерирует RouteChanged → предложение перезапуска. | `dialog_manage_routes.cpp:96–109`, `mainwindow.cpp:294–311` | MUST |
| FR-UI-142 | Отображение превью маршрута | `DisplayRouting()`: краткое перечисление Proxy/Direct/Block домены+IP, default outbound, режим DNS. | `NekoGui.cpp:351–361` | MUST |
| FR-UI-143 | Rule-sets (geo) | `geoip:X`/`geosite:X` транслируются в удалённые `.srs` rule-set (MetaCubeX meta-rules-dat, download_detour=direct, формат binary, дедупликация тегов). | `ConfigBuilder.cpp:461–478` | MUST |
| FR-UI-144 | Встроенные правила | Блок UDP-портов 135/137/138/139/5353; блок multicast (224.0.0.0/3, ff00::/8) по назначению и источнику; dns-hijack; sniff action для mixed-in/tun-in (timeout 3s). | `ConfigBuilder.cpp:663–699, 733–740` | MUST |
| FR-UI-145 | Правила TUN-режима | Правила process_name и ip_cidr из настроек TUN (bypass/whitelist); автобайпас путей внешних ядер. | `ConfigBuilder.cpp:701–727` | MUST |
| FR-UI-146 | «Save as route» из лога | Контекстное меню лога: выделенный текст → редактирование → выбор категории (proxyIP/bypassIP/blockIP/proxyDomain/bypassDomain/blockDomain) → добавление в активный маршрут. | `mainwindow.cpp:1568–1611` | NICE |
| FR-UI-147 | Примечание независимости | Подпись в диалоге: «Note: Other settings are independent for each route set.» | `ui/dialog_manage_routes.ui` | NICE |

---

## 7. DNS

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-148 | Simple DNS Settings | Remote DNS (URL/строка, напр. `https://dns.google/dns-query`), Query Strategy (пусто/prefer_ipv4/prefer_ipv6/ipv4_only/ipv6_only); Direct DNS (напр. `https://doh.pub/dns-query`) + стратегия; Enable DNS Routing (чекбокс); Final DNS Out (proxy/direct). | `dialog_manage_routes.cpp:146–151, 166–174`, `NekoGui_DataStore.hpp:17–24` | MUST |
| FR-UI-149 | DNS Object Settings | Чекбокс «Use DNS Object»: отключает Simple-блок, включает текстовое поле полного JSON DNS sing-box + кнопки Format (форматирование/валидация) и Document (URL документации sing-box DNS); плейсхолдер-шаблон. | `dialog_manage_routes.cpp:37–53` | MUST |
| FR-UI-150 | DNS Routing | Если включён — домены proxy-листа идут в remote DNS, direct-листа (и адреса серверов) — в direct DNS. | `ConfigBuilder.cpp:150–172, 617–625` | MUST |
| FR-UI-151 | FakeDNS | Чекбокс в TUN-настройках: включает fakeip-сервер и правило для tun-in (диапазоны 198.18.0.0/15, fc00::/18). | `dialog_vpn_settings.cpp:14`, `ConfigBuilder.cpp:609–611, 641–648` | NICE |
| FR-UI-152 | Underlying DNS | Переопределение «нижнего» DNS ядра (настройка Core Options, default `local`); используется как dns-local/resolver. | `dialog_basic_settings.cpp:374–378`, `ConfigBuilder.cpp:614` | NICE |
| FR-UI-153 | Встроенные DNS-правила | Блокирование query_type 32/33 (HTTPS/TLS) и `.lan` с NOERROR. | `ConfigBuilder.cpp:628–639` | MUST |
| FR-UI-154 | Предупреждение systemd-resolved | Linux + TUN + direct_dns=local + /etc/resolv.conf от systemd-resolved → предупреждение в лог. | `mainwindow_grpc.cpp:398–403` | NICE |
| FR-UI-155 | Трансляция адресов DNS | Строки `udp://хост:порт`, `tls://`, `https://`, `h3://`, `quic://`, `tcp://`, `dhcp://`, `local`, `fakeip` преобразуются в типизированные DNS-серверы sing-box 1.12+ (тип, server, server_port, path, detour, domain_resolver). | `ConfigBuilder.cpp:533–598` | MUST (реализовано в ядре LAVRay) |

---

## 8. Базовые настройки

Файл: `ui/dialog_basic_settings.cpp/.ui` (все значения — в `main/NekoGui_DataStore.hpp`).

| ID | Название | Поведение | Приоритет |
|----|----------|-----------|-----------|
| FR-UI-156 | Секция Common: Listen Address | Адрес inbound (127.0.0.1 / :: и т.д.). | MUST |
| FR-UI-157 | Mixed (SOCKS+HTTP) Listen Port | Порт mixed-inbound (default 2080). | MUST |
| FR-UI-158 | Inbound Auth | Кнопка с иконкой замка (открыт/закрыт по факту наличия логина-пароля); диалог Username/Password; авторизация на inbound. | MUST |
| FR-UI-159 | Custom Inbound | JSON-редактор `{"inbounds": []}` — дополнительные inbound добавляются к конфигу. | MUST |
| FR-UI-160 | Latency Test URL | URL для URL-теста (default `http://cp.cloudflare.com/`). | MUST |
| FR-UI-161 | Concurrent | Число параллельных потоков тестирования (default 5). | MUST |
| FR-UI-162 | Download Test URL / Timeout | URL и таймаут (сек) загрузки в Full Test (default cachefly 10mb / 30 c). | MUST |
| FR-UI-163 | Include Pre-release | Учитывать pre-release при проверке обновлений. | NICE |
| FR-UI-164 | Old Share Link Format | Формат VMess-ссылки (совместимость с v2rayN). | MUST |
| FR-UI-165 | System proxy format (Windows) | Кнопка выбора формата строки системного прокси из пресетов (`{ip}:{http_port}`, `socks=…`, `http=…;https=…;ftp=…;socks=…`, `http=http://…`). | NICE |
| FR-UI-166 | Секция Style: Theme | Комбо: System, 3 встроенных QSS (flatgray / lightblue / blacksoft), все стили QStyleFactory; смена применяется мгновенно и сохраняется. | NICE |
| FR-UI-167 | Set custom icon | Выбор квадратного PNG (валидация) / сброс; иконка окна и трея. | NICE |
| FR-UI-168 | Statistics refresh rate | Комбо: 500/1000/2000/3000/5000 мс / Off — интервал цикла статистики. | MUST |
| FR-UI-169 | Connection statistics | Чекбокс включения списка соединений (в текущем форке визуально заблокирован — см. UX-14). | MUST |
| FR-UI-170 | Hide dashboard at startup | Запуск свёрнутым в трей. | MUST |
| FR-UI-171 | Max log lines | Лимит строк лога (default 200; <=0 → 200). | MUST |
| FR-UI-172 | Language | Комбо: System / English / 简体中文 / فارسی / Русский; требует перезапуска. | MUST |
| FR-UI-173 | Секция Subscription | Automatic update (вкл/выкл) + Interval (минуты, <30 невалиден); Use proxy when updating; Ignore TLS errors; Clear servers before updating; User Agent (плейсхолдер — дефолтный UA). | MUST |
| FR-UI-174 | Секция Core (sing-box): Core Options | Диалог: Override underlying DNS; Enable Clash API + порт + secret (external_ui=dashboard). | NICE |
| FR-UI-175 | Extra Core | Скролл-список внешних ядер (по умолчанию записи naive, hysteria2, tuic): имя + путь + выбор файла; кнопки Add (ввод имени) и Delete (выбор из списка). Используется редактором Custom и QUIC/Naive. | MUST |
| FR-UI-176 | Секция Mux | Protocol (h2mux/smux/yamux), Padding, Concurrency, Default On. | MUST |
| FR-UI-177 | Секция Security | Skip TLS certificate authentication by default (allowInsecure); Default uTLS Fingerprint (комбо пресетов). | MUST |

---

## 9. TUN / VPN

Файлы: `ui/dialog_vpn_settings.*`, `db/ConfigBuilder.cpp:773–844`, `mainwindow.cpp:740–803, 1777–1851`.

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-178 | Tun Settings: поля | Tun Enable IPv6; Internal Tun (единый процесс sing-box); Hide Console (Windows); Strict Route; MTU (комбо 1000–10000, default 9000, клампится); Implementation (gvisor/system/mixed); Fake DNS (FR-UI-151); Whitelist mode; Bypass CIDR / Bypass Process Name (многострочные; в whitelist-режиме подписи меняются на «Proxy CIDR/Process Name»); Troubleshooting. | `dialog_vpn_settings.cpp:10–68` | MUST |
| FR-UI-179 | Включение TUN (internal) | Требует прав: Windows — предложение «run as admin» → перезапуск с повышением (UAC, код выхода 3); Linux — pkexec setcap `cap_net_admin=ep` на nekobox_core → перезапуск; ошибка AppImage объясняется в логе; macOS — см. FR-UI-184. | `mainwindow.cpp:740–770` | MUST |
| FR-UI-180 | Внешний TUN-режим (не internal) | Отдельный процесс nekobox_core с vpn-конфигом: Windows — runProcessElevated (hide/minimized console); Linux — pkexec bash script; macOS — osascript admin. Правила process/cidr из настроек проксируются в VPN-конфиг; атутентикация mixed-in прокидывается. | `mainwindow.cpp:1777–1819`, `ConfigBuilder.cpp:773–825` | NICE |
| FR-UI-181 | Остановка внешнего TUN | Windows: elevated `taskkill /IM nekobox_core.exe /FI PID ne <core>`; Linux: pkexec killall/pkill; macOS: osascript pkill; ошибка → диалог. | `mainwindow.cpp:1821–1851` | NICE |
| FR-UI-182 | Troubleshooting | Диалог: сброс зависшего nekobox_core (принудительный StopVPNProcess) + ссылка на документацию. | `dialog_vpn_settings.cpp:71–81` | NICE |
| FR-UI-183 | Конфликт сервера с TUN | Если профиль требует внешний TUN-off (`need_keep_vpn_off`) — сообщение «Current server is incompatible with Tun…». | `mainwindow.cpp:772–775` | MUST |
| FR-UI-184 | Параметры tun-in | interface_name (neko-tun / utun9 на macOS), auto_route, endpoint_independent_nat, mtu, stack, strict_route, address 172.19.0.1/28 (+IPv6 fdfe:…/126). | `ConfigBuilder.cpp:414–428` | MUST (уровень ядра) |
| FR-UI-185 | Перезапуск при смене Tun-настроек | VPNChanged → предупреждение «Restart Tun to take effect» при активном TUN; смена Internal Tun → NeedRestart программы. | `dialog_vpn_settings.cpp:55–67`, `mainwindow.cpp:534–536` | MUST |
| FR-UI-186 | Remember spmode | При включённом «Remember last profile» запоминаются включённые режимы (system_proxy/vpn) и восстанавливаются при старте (в т.ч. через флаг `-flag_restart_tun_on` после перезапуска с повышением). | `mainwindow.cpp:414–422`, `main/main.cpp:92` | MUST |

---

## 10. Горячие клавиши

Файлы: `ui/dialog_hotkey.*`, `mainwindow.cpp:1715–1775`, `3rdparty/QHotkey`.

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-187 | Настраиваемые глобальные хоткеи | 4 слота: Trigger main window; Show groups; Show routes; System Proxy (открывает меню spmode у курсора). Редактор — key sequence edit; при открытии диалога хоткеи временно снимаются. | `ui/dialog_hotkey.ui/.cpp` | NICE |
| FR-UI-188 | Проверка конфликтов | Дубликаты не регистрируются; невозможные к регистрации последовательности пропускаются молча. | `mainwindow.cpp:1730–1752` | MUST |
| FR-UI-189 | Локальные шорткаты таблицы | Return=Start; Ctrl+S=Stop; Ctrl+V=вставка; Del=удалить; Ctrl+A=выделить всё; Ctrl+M=move; Ctrl+D=clone; Ctrl+R=reset traffic; Ctrl+Q=QR; Ctrl+E=export config; Ctrl+C=copy links; Ctrl+N=copy Neko links; Ctrl+U=update subscription; Ctrl+F=search; Esc=отмена поиска/select mode; Ctrl+Alt+T/U/F/S/C/I/R/D — см. раздел 1.4/12. | `ui/mainwindow.ui:592–927` | MUST |

---

## 11. Импорт / экспорт / шаринг / QR / happ

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-190 | Share link (стандартный) | Генерация ссылок по типу: ss://, vmess:// (base64 JSON, режим v2rayN), vless://, trojan://, socks/http, naive+, hysteria2/hy2, tuic — с параметрами транспорта (type/security/host/path/sni/alpn/fp/pbk/sid/flow/encryption и пр.). | `fmt/Bean2Link.cpp` | MUST |
| FR-UI-191 | Neko Links | `nekoray://<type>#<base64url(JSON bean)>` — полное сохранение полей профиля (включая custom). | `fmt/AbstractBean.cpp:18–27` | MUST |
| FR-UI-192 | Copy links (Ctrl+C) | Копирование стандартных ссылок выделенных профилей (по одной на строку); лог «Copied N item(s)»; если фокус в логе — копируется текст лога. | `mainwindow.cpp:1179–1192` | MUST |
| FR-UI-193 | Copy Neko links (Ctrl+N) | То же для Neko-ссылок. | `mainwindow.cpp:1194–1203` | MUST |
| FR-UI-194 | QR Code and link (Ctrl+Q) | Диалог: QR-код (масштабируется под окно), чекбокс «Neko Links» (переключает ссылку), read-only текст ссылки; заголовок — тип+имя профиля. | `mainwindow.cpp:1233–1315` | MUST |
| FR-UI-195 | Scan QR Code | Скрыть окно → пауза 1 с → снимок основного экрана → ZXing (QR, без поворота) → результат в лог + импорт; «QR Code not found» если не найдено. | `mainwindow.cpp:1317–1344` | NICE |
| FR-UI-196 | Export config (Ctrl+E) | Для профиля на sing-box: копирование в буфер сгенерированного core-конфига; кнопки выбора «Copy core config» / «Copy test config» (конфиг для теста без inbounds/маршрутов пользователя). | `mainwindow.cpp:1205–1231` | MUST |
| FR-UI-197 | Импорт из ссылки в редакторе | `TryParseLink` у каждого bean — разбор своей схемы (симметрично Bean2Link). | `fmt/Link2Bean.cpp` | MUST |
| FR-UI-198 | Decrypt Happ link (диалог) | Поле ввода `happ://crypt5/…`; кнопка Decrypt (асинхронно, через подпроцесс `nekobox_core happ-decrypt <link>`, JSON-ответ {ok,result,error}); результат read-only; статус-подсказка «Looks like a subscription URL…» / «…proxy links»; кнопки: Add to NekoBox (импорт), Copy result (с фидбеком «Copied!»), Close. | `ui/dialog_happ_decrypt.cpp`, `main/HappLink.cpp`, `go/cmd/nekobox_core/happ/happdecrypt.go` | MUST (для RU) |
| FR-UI-199 | Расшифровка happ на стороне ядра | Ключи crypt5/native в активах Go-ядра; CLI `happ-decrypt` печатает однострочный JSON (используется и GUI, и подписчик). | `go/cmd/nekobox_core/happ/*` | MUST (уровень ядра) |

---

## 12. Тесты соединения

Файлы: `ui/mainwindow_grpc.cpp:56–277`, `go/grpc_server/fulltest.go`, `go/grpc_server/gen/libcore.proto`.

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-200 | Tcp Ping (Ctrl+Alt+T) | TCP-коннект до адреса профиля; мс или «Unavailable». | `mainwindow_grpc.cpp:196–198` | MUST |
| FR-UI-201 | Url Test (Ctrl+Alt+U) | HTTP-запрос через тестовый конфиг профиля (URL из настроек; timeout 10 c). | `mainwindow_grpc.cpp:161–195` | MUST |
| FR-UI-202 | Full Test (Ctrl+Alt+F) | Диалог опций: Latency / UDP latency / Download speed / In and Out IP (чекбоксы, минимум один); отчёт строкой в колонке Test Result (поле `full_test_report`, приоритетнее latency): «Latency: Xms; UDPLatency: …; Speed: …; IP: …». | `mainwindow_grpc.cpp:84–118`, `fulltest.go` | MUST |
| FR-UI-203 | Stop Testing (Ctrl+Alt+S) | Остановка всех потоков тестирования (магический режим 114514). | `mainwindow_grpc.cpp:74–81` | MUST |
| FR-UI-204 | Clear Test Result (Ctrl+Alt+C) | Сброс latency и full_test_report у выделения/группы. | `mainwindow.cpp:1352–1359` | MUST |
| FR-UI-205 | Область применения | Тест применяется к выделенным профилям либо ко всей группе (в зависимости от подменю, FR-UI-041); кнопка URL Test всегда тестирует группу. | `mainwindow.cpp:1459–1480` | MUST |
| FR-UI-206 | Параллельность | Пул из `test_concurrent` потоков; повторный запуск заблокирован, пока не завершился предыдущий (диалог-предупреждение). | `mainwindow_grpc.cpp:61–65, 119–131` | MUST |
| FR-UI-207 | Тест текущего профиля | Клик по метке статуса (FR-UI-045): UrlTest работающего прокси без пересборки; результат в метке. | `mainwindow_grpc.cpp:247–277` | NICE |
| FR-UI-208 | Ошибки теста | Ошибка конфига профиля пишется прямо в колонку результата; ошибки RPC — в лог «[профиль] test error: …»; по завершении — «Speedtest finished.» | `mainwindow_grpc.cpp:164–169, 226–243` | MUST |
| FR-UI-209 | Обновление UI в процессе | Каждая завершённая строка обновляется в таблице немедленно (по id). | `mainwindow_grpc.cpp:230–233` | MUST |

---

## 13. Статистика трафика и список соединений

Файлы: `db/traffic/TrafficData.hpp`, `db/traffic/TrafficLooper.cpp`, `mainwindow_grpc.cpp`, `ui/mainwindow.cpp`.

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-210 | Скорости в статусной строке | «Proxy: X↑ Y↓\nDirect: …» — скорости активного профиля (таг proxy) и direct/bypass; обновляются циклом TrafficLooper. | `TrafficLooper.cpp:113–120`, `mainwindow.cpp:805–825` | MUST |
| FR-UI-211 | Накопленный трафик профиля | Колонка Traffic: `X↑ Y↓` (ReadableSize); persisted в JSON профиля (`dl`/`ul`); для цепочек учитывается таг цепочки. | `TrafficData.hpp`, `ConfigBuilder.cpp:141–146` | MUST |
| FR-UI-212 | Reset Traffic | FR-UI-037; сброс счётчиков (сохранение). | `mainwindow.cpp:1156–1164` | MUST |
| FR-UI-213 | Вкладка Connection | Таблица: Status (иконка: block=cancel, закрыто=history, активно=swap-vertical; тултип Start/End временем), Outbound (таг), Destination («[Dest] RDest»); строки с тагами из ignoreConnTag скрыты; обновляется циклом при включённой connection_statistics; очистка при остановке. | `mainwindow.cpp:1653–1713`, `TrafficLooper.cpp:96–99` | MUST |
| FR-UI-214 | Цикл статистики | Поток с интервалом из настроек; при 0 (Off) — только финальное обновление при остановке; запрос QueryStats по тегам outbounds (proxy, bypass + профили цепочки). | `TrafficLooper.cpp:56–124`, `mainwindow_grpc.cpp:312–317` | MUST |

---

## 14. Логи

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-215 | Вкладка Log | QTextBrowser с моноширинным системным шрифтом 9pt; авто-скролл при нахождении внизу (отключается ручным скроллом); ограничение `max_log_line` строк (удаление старых блоков). | `mainwindow.cpp:109–141, 1497–1540` | MUST |
| FR-UI-216 | Фильтр лога (log_ignore) | Список ключевых слов: строки, содержащие любое, не отображаются; антифлуд: не более max_log_line строк/сек от ядра. | `mainwindow.cpp:1506–1522`, `sys/ExternalProcess.cpp:25–28` | MUST |
| FR-UI-217 | Контекстное меню лога | Стандартное (копировать/выделить) + Set ignore keyword (предзаполнение выделением, многострочный редактор) + Save as route (FR-UI-146) + Clear. | `mainwindow.cpp:1546–1622` | MUST |
| FR-UI-218 | VT100 | Вывод внешних ядер очищается от ANSI-escape (VT100Parser). | `mainwindow.cpp:139–141`, `3rdparty/VT100Parser.hpp` | MUST |
| FR-UI-219 | Префиксы источников | `[Error]`, `[<таг внешнего ядра>]`, `>>>>>>>`/`<<<<<<` для старт/стоп и подписок. | повсеместно | MUST |
| FR-UI-220 | Уровень лога ядра | Настройка log_level (trace…panic) передаётся в конфиг ядра. | `dialog_basic_settings.cpp:62`, `ConfigBuilder.cpp:391` | MUST |

---

## 15. Системная интеграция

### 15.1. Системный прокси

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-221 | Установка системного прокси | Windows: WinINET `InternetSetOption` (LAN + все RAS-соединения, SETTINGS_CHANGED+REFRESH), строка из настраиваемого формата (FR-UI-165); Linux GNOME: gsettings (http/https/ftp + socks, mode=manual), KDE: kwriteconfig5 + dbus reparse; macOS: networksetup -setwebproxy/-setsecurewebproxy/-setsocksfirewallproxy для каждого network service. | `3rdparty/qv2ray/v2/components/proxy/QvProxyConfigurator.cpp` | MUST |
| FR-UI-222 | Снятие системного прокси | Симметричная очистка при выключении и при выходе (WinINET DIRECT, gsettings mode=none, networksetup off). | там же, `mainwindow.cpp:655` | MUST |
| FR-UI-223 | Синхронизация состояния | Чекбоксы/меню всегда отражают datastore-состояние spmode_*; включение возможно только при Mixed-порту. | `mainwindow.cpp:326–336, 717–738` | MUST |

### 15.2. Автозапуск

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-224 | Автозапуск | Windows: HKCU\…\Run, значение `"путь" -tray`; macOS: LoginItems (LSSharedFileList); Linux: ~/.config/autostart/<app>.desktop (Exec с -tray, учёт AppImage и launcher). Проверка включённости — чтением реального состояния ОС. | `sys/AutoRun.cpp` | MUST |

### 15.3. Трей/окно/ОС-специфика

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-225 | Трей | FR-UI-048–052; иконка из ресурсов/пакета/пользовательского PNG + бейдж статуса. | `ui/Icon.cpp`, `mainwindow.cpp` | MUST |
| FR-UI-226 | Определение админа | Windows: IsUserAnAdmin; Linux: euid==0 или getcap cap_net_admin на nekobox_core; macOS: euid. Признак «[Admin]» в заголовке. | `main/NekoGui.cpp:442–461`, `sys/windows/guihelper.cpp` | MUST |
| FR-UI-227 | Повышение прав (UAC/pkexec) | FR-UI-179, 180, 181: WinCommander::runProcessElevated, pkexec, osascript. | `3rdparty/WinCommander`, `sys/linux/LinuxCap.cpp` | MUST |
| FR-UI-228 | Активация окна | Windows AttachThreadInput+SetForegroundWindow (обход ограничений foreground). | `sys/windows/guihelper.cpp:9–17` | MUST |
| FR-UI-229 | Crash handler | Windows MiniDump при падении GUI. | `sys/windows/MiniDump.*`, `main/main.cpp:57` | NICE |
| FR-UI-230 | Обновление приложения | Проверка через ядро (GitHub releases): диалог с версией, заметками (pre-release помечен), кнопки Update (скачивание через ядро; затем «restart to install?» → запуск `updater` при выходе) / Open in browser / Close; updater недоступен в appdata-режиме. | `mainwindow_grpc.cpp:490–554`, `go/cmd/updater/*` | MUST |

### 15.4. Процессы ядра и внешние ядра

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-231 | Запуск nekobox_core | Подпроцесс: `nekobox_core nekobox -port <случайный>` (+`-debug`); token (32 случайных символа) пишется в stdin; порт по умолчанию 19810; готовность ядра определяется по строке «grpc server listening» в stdout. | `mainwindow.cpp:386–412`, `sys/ExternalProcess.cpp:73–156` | MUST |
| FR-UI-232 | Авторестарт ядра | При падении ядра (не по команде): попытка рестарта с тем же профилем; rate-limit 10 с («Core exits too frequently…»); при FailedToStart — без ретраев; CoreCrashed → остановка прокси. | `ExternalProcess.cpp:106–139` | MUST |
| FR-UI-233 | Внешние ядра (managed processes) | naive/hysteria2/tuic/custom: запуск программы с аргументами/ENV, захват stdout/stderr (VT100) в лог с тагом; краш → остановка прокси и сообщение; корректное завершение при stop. | `ExternalProcess.cpp:11–67`, `mainwindow_grpc.cpp:20–34` | MUST |
| FR-UI-234 | Автобайпас внешних ядер в TUN | Пути программ внешних ядер автоматически добавляются в process_name-bypass правила TUN. | `ConfigBuilder.cpp:14–22, 721–726` | MUST |
| FR-UI-235 | Аргументы внешних ядер | Подстановка `%mapping_port%`, `%socks_port%`, `%server_addr%`, `%server_port%`; mapping inbound (direct, override_address/port) и socks-outbound на 127.0.0.1; статистика через таг. | `fmt/Bean2External.cpp`, `ConfigBuilder.cpp:248–327` | MUST |
| FR-UI-236 | Диалог «долгого запуска» | Если Start/Stop не отвечает >5 с — диалог с предложением перезапустить программу (авто-отменяемый). | `mainwindow_grpc.cpp:376–379, 468–471` | MUST |

---

## 16. Локализация, темы, иконки

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-237 | Языки | Встроенные переводы: en (исходник), zh_CN, fa_IR, ru_RU (компилированные .qm в ресурсах); + внешние qtbase_*.qm; выбор: System/En/zh/fa/ru; смена требует рестарта. | `main/main.cpp:203–221`, `translations/` | MUST |
| FR-UI-238 | Механизм перевода | Qt Linguist: контексты по классам диалогов/виджетов (MainWindow, DialogBasicSettings, DialogEditProfile, Edit*, GroupItem, ProxyItem, JsonEditor и др.); 410+ строк в ru_RU.ts. | `translations/ru_RU.ts` | MUST (для LAVRay — i18n-фреймворк React с тем же покрытием) |
| FR-UI-239 | Принудительный LTR | Карточки групп/профилей и лог всегда LeftToRight (иначе ломается в RTL-локали fa_IR). | `GroupItem.cpp:16`, `ProxyItem.cpp:9` | NICE |
| FR-UI-240 | Темы | System; 3 встроенных QSS; стили QStyleFactory; собственный neko.css поверх; кастомная иконка PNG. | `ui/ThemeManager.cpp`, `res/` | NICE |
| FR-UI-241 | Иконки Material | Набор material SVG (cancel/history/swap-vertical/lock-*) для UI. | `ui/Icon.cpp:47–50`, `res/icon/material/` | NICE |

---

## 17. Модель данных и хранение

Файлы: `db/Database.cpp/.hpp`, `main/NekoGui.cpp` (JsonStore), `main/main.cpp`.

| ID | Название | Поведение | Источник | Приоритет |
|----|----------|-----------|----------|-----------|
| FR-UI-242 | JSON-файлы на профиль | `profiles/<id>.json`: type, id, gid, latency (yc), full_test_report, bean (вложенный JSON по типу), traffic (dl/ul). | `db/Database.cpp:208–224` | MUST |
| FR-UI-243 | JSON-файлы групп | `groups/<id>.json`: id, name, url, order, info, lastup, archive, skip_auto_update, front_proxy_id, column_width… | `db/Database.cpp:306–318` | MUST |
| FR-UI-244 | Профиль-менеджер | `groups/pm.json` — порядок вкладок групп; при загрузке: сканирование каталогов, чистка битых профилей, автосоздание группы «Default», синхронизация order↔файлы. | `db/Database.cpp:35–135` | MUST |
| FR-UI-245 | Datastore | `groups/nekobox.json` — все настройки (см. `NekoGui_DataStore.hpp`); сохранение при каждом изменении; флаг no-save при выходе. | `main/NekoGui.cpp:229–286` | MUST |
| FR-UI-246 | Наборы маршрутов | Каталог `routes/` — по файлу на набор (имя = имя файла). | `main/main.cpp:170–172`, `NekoGui.cpp:363–366` | MUST |
| FR-UI-247 | Каталоги | Рабочий каталог = каталог exe, либо `-appdata [dir]` / AppConfigLocation; подкаталоги config/, profiles/, groups/, routes/, temp/ (чистится), dashboard/, vpn/ (оверрайды vpn-конфига/скрипта), nekobox.png. | `main/main.cpp:100–113, 161–176` | MUST |
| FR-UI-248 | Миграция/сервисный режим | Флаг `-flag_reorder`: перенумерация id профилей и групп подряд (с сообщением). | `db/Database.cpp:85–135` | NICE |
| FR-UI-249 | Уникальные ключи дедупликации | Профиль-ключ = JSON bean (без custom_config/custom_outbound) + тип; либо адрес+тип. Используется в Remove Duplicates и diff подписок. | `db/ProfileFilter.cpp:3–8` | MUST |
| FR-UI-250 | Изменяемость и сохранение | Save возвращает changed (сравнение последней записи) — на этом построены «restart proxy?» подсказки. | `NekoGui.cpp:184–199` | MUST |

---

## 18. Контракт UI ↔ ядро

Файлы: `rpc/gRPC.h/.cpp`, `go/grpc_server/gen/libcore.proto`, `go/grpc_server/grpc.go`.

| ID | Название | Поведение | Приоритет |
|----|----------|-----------|-----------|
| FR-UI-251 | Транспорт | gRPC на 127.0.0.1:<core_port>, авторизация токеном (пишется в stdin ядра при старте). | MUST |
| FR-UI-252 | Методы | Exit; Update(Check/Download); Start(LoadConfigReq: core_config JSON, enable_nekoray_connections, stats_outbounds[]); Stop; Test(TestReq: mode TcpPing/UrlTest/FullTest, timeout, url, config, in_address, full_latency/udp_latency/speed/in_out, speed_url, speed_timeout); QueryStats(tag, direct); ListConnections. | MUST |
| FR-UI-253 | События UI от ядра | Строки stdout: «grpc server listening» (готовность), «token is set» (включение stderr-лога), «failed to serve» (ошибка старта); обнаружение и диспетчеризация — в CoreProcess. | MUST |
| FR-UI-254 | Формат соединений | JSON-массив nekoray_connections: {ID, Start, End, Tag, Dest, RDest}. | MUST |
| FR-UI-255 | Ответ теста | {ms (0=не тестировано, >0 латентность), error, full_report (строка отчёта FullTest)}. | MUST |
| FR-UI-256 | Сборка конфига ядра | Единая функция BuildConfig(ent, forTest, forExport) — генерирует полный sing-box JSON: log, inbounds (mixed/tun/custom), outbounds (цепочка+direct/bypass/block), DNS (типизированные серверы 1.12+), route (сниффинг, rule_set, default_domain_resolver, final), experimental (clash_api) + глубокий merge custom_config. LAVRay должен сохранить все точки расширения (см. FR-UI-084/085/143/144). | MUST |

---

## 19. Таблица «фича → файл-источник»

| Фича (кластер) | Файлы в форке |
|---|---|
| Главное окно, меню, трей, статус | `ui/mainwindow.ui`, `ui/mainwindow.cpp`, `ui/mainwindow.h` |
| Запуск/стоп/тесты/обновление (gRPC-логика) | `ui/mainwindow_grpc.cpp` |
| Редактор профиля (каркас, stream, apply-to-group) | `ui/edit/dialog_edit_profile.cpp/.ui`, `ui/edit/profile_editor.h` |
| Редакторы по типам | `ui/edit/edit_socks_http.*`, `edit_shadowsocks.*`, `edit_vmess.*`, `edit_trojan_vless.*`, `edit_naive.*`, `edit_quic.*`, `edit_chain.*`, `edit_custom.*` |
| Модели данных профилей | `fmt/AbstractBean.hpp/.cpp`, `SocksHttpBean.hpp`, `ShadowSocksBean.hpp`, `VMessBean.hpp`, `TrojanVLESSBean.hpp`, `NaiveBean.hpp`, `QUICBean.hpp`, `ChainBean.hpp`, `CustomBean.hpp`, `V2RayStreamSettings.hpp` |
| Ссылки share/parse | `fmt/Bean2Link.cpp`, `fmt/Link2Bean.cpp`, `fmt/AbstractBean.cpp` |
| Сборка конфигов sing-box / TUN-конфиг | `db/ConfigBuilder.cpp/.hpp` |
| БД профилей/групп, дедуп | `db/Database.cpp/.hpp`, `db/Group.hpp`, `db/ProxyEntity.hpp`, `db/ProfileFilter.cpp/.hpp` |
| Статистика/соединения | `db/traffic/TrafficData.hpp`, `db/traffic/TrafficLooper.cpp/.hpp` |
| Подписки/импорт/happ-поток | `sub/GroupUpdater.cpp/.hpp`, `main/HTTPRequestHelper.cpp/.hpp` |
| Happ-расшифровка (GUI-обёртка) | `main/HappLink.cpp/.hpp`, `ui/dialog_happ_decrypt.cpp/.h`, `go/cmd/nekobox_core/happ/*` |
| Группы: диалоги | `ui/dialog_manage_groups.*`, `ui/edit/dialog_edit_group.*`, `ui/widget/GroupItem.*`, `ui/widget/ProxyItem.*` |
| Маршрутизация + DNS UI | `ui/dialog_manage_routes.*`, `3rdparty/qv2ray/v3/components/GeositeReader/GeositeReader.hpp` (гео-автодополнение) |
| Базовые настройки | `ui/dialog_basic_settings.*` |
| TUN-настройки | `ui/dialog_vpn_settings.*`, `res/vpn/sing-box-vpn.json`, `res/vpn/vpn-run-root.sh` |
| Горячие клавиши | `ui/dialog_hotkey.*`, `3rdparty/QHotkey/`, `3rdparty/QtExtKeySequenceEdit.*` |
| Таблица профилей (drag/sort) | `ui/widget/MyTableWidget.h`, `ui/GroupSort.hpp` |
| JSON-редактор | `3rdparty/qv2ray/v2/ui/widgets/editors/w_JsonEditor.hpp` |
| QR | `3rdparty/qrcodegen/*` (генерация), `3rdparty/ZxingQtReader.hpp` (скан) |
| Системный прокси ОС | `3rdparty/qv2ray/v2/components/proxy/QvProxyConfigurator.cpp/.hpp` |
| Автозапуск | `sys/AutoRun.cpp/.hpp` |
| Процессы ядра/внешние ядра | `sys/ExternalProcess.cpp/.hpp` |
| Linux caps / pkexec | `sys/linux/LinuxCap.cpp/.h` |
| Windows helpers / дампы / elevation | `sys/windows/guihelper.*`, `sys/windows/MiniDump.*`, `3rdparty/WinCommander.*` |
| Темы/иконки | `ui/ThemeManager.*`, `ui/Icon.*`, `res/theme/`, `res/neko.css` |
| Локализация | `translations/*.ts`, `translations.qrc`, `main/main.cpp:203–221` |
| Стартап/флаги/RunGuard | `main/main.cpp`, `3rdparty/RunGuard.hpp` |
| gRPC-контракт | `rpc/gRPC.*`, `go/grpc_server/gen/libcore.proto`, `go/grpc_server/grpc.go`, `go/grpc_server/fulltest.go` |
| Обновщик | `go/cmd/updater/*` |
| Пресеты (методы SS, uTLS, DNS-стратегии, sp-форматы) | `fmt/Preset.hpp` |
| Утилиты (B64, размеры, время, IP) | `main/NekoGui_Utils.cpp/.hpp` |

---

## 20. UX-проблемы текущего NekoBox (рекомендации для LAVRay)

Найдено при аудите кода; каждое — кандидат на исправление в редизайне.

1. **Перегруженное меню Server.** Одно контекстное меню обслуживает и выделение, и группу, и создание; пункты тестирования физически «переезжают» между подменю Current Select/Current Group в момент открытия (`mainwindow.cpp:343–372`) — пользователь не понимает, к чему применится действие. → В LAVRay: явный scope-переключатель (Selection / Group) или разделение действий.
2. **Скрытые аффордансы.** Клик по метке статуса = тест текущего профиля, клик по метке inbound = настройки, двойной клик по сплиттеру = 50/50, угловая кнопка таблицы = сброс порядка. Ничего не подписано. → Кнопки/тултипы.
3. **Сортировка без индикатора.** Повторный клик по тому же заголовку инвертирует порядок, но стрелки-индикатора нет; сброс сортировки — только угловой кнопкой. Комментарий в коде: «不正确的descending实现» («некорректная реализация убывания»).
4. **Модальные диалоги-«матрёшки».** Core Options, Inbound Auth, Load/Save routes, Full Test options — вложенные модалки; часть действий подтверждается дважды (Save route → вопрос с превью). → Inline-панели/виртуальные экраны.
5. **«Restart proxy?» после каждого чиха.** Любое сохранение настроек/профиля при запущенном прокси даёт вопрос о перезапуске (FR-UI-062). → Автоприменение живых настроек + единый индикатор «требуется перезапуск» с одной кнопкой.
6. **Мёртвый UI.** Чекбокс «Connection statistics» в Basic Settings принудительно заблокирован (`dialog_basic_settings.cpp:96`), хотя функциональность существует. Либо включить, либо убрать.
7. **Активные серверы в меню — до 100 пунктов.** `menuActive_Server` обрезается на 100; без поиска и прокрутки в трее это неюзабельно для больших подписках. → Поиск/избранное/последние.
8. **Select mode — необычная механика.** Редактор chain и front proxy скрывают диалог и переводят главное окно в «режим выбора» (FR-UI-055); Esc отменяет всё. Пользователь теряет контекст. → Встроенный пикер профиля в диалоге (с поиском).
9. **QR-скан только по всему главному экрану**, без выбора области и камеры, с паузой в 1 с и миганием окна (`mainwindow.cpp:1317–1344`). → Выбор области/окна/камера.
10. **Латентность и Full Test в одной колонке.** `full_test_report` (строка) подменяет цветную латентность; цветовая индикация при этом теряется. → Отдельная колонка/детали по клику.
11. **Логи без уровней/фильтров во времени.** Фильтр только по статическим ключевых словам (log_ignore) и лимиту строк; нет паузы/поиска/копирования всей истории в файл. VT100-чистка только для внешних ядер.
12. **Список соединений почти без действий.** Нет закрытия соединения, нет деталей (правило, inbound, время жизни), нет фильтра по outbound.
13. **Move через текстовый список «0 Default».** Диалог переноса профилей показывает `"<id> <name>"` (`mainwindow.cpp:1132`) — сырой id виден пользователю.
14. **Скрытые настройки-кнопки.** System proxy format (Win), Inbound Auth, Core Options — кнопки без пояснений; Extra Core (пути к бинарникам) — в «Basic Settings», хотя это advanced.
15. **Зависимость happ-расшифровки от бинарника nekobox_core.** GUI вызывает подпроцесс `nekobox_core happ-decrypt`; при отсутствии/битом ядре — техническая ошибка «Could not run the decryptor». → Встроенная реализация в LAVRay-ядре + человекочитаемые ошибки.
16. **Язык только с перезапуском** (NeedRestart), RTL-локаль частично ломала UI (костыль setLayoutDirection LTR).
17. **Темы устарели.** 3 QSS-темы 2019-го года + системный стиль; тёмной темы по умолчанию нет; кастомная иконка — только квадратный PNG рядом с exe.
18. **Профили без метаданных.** Нет тегов, заметок, дат, ручной сортировки «в избранное»; сортировка по умолчанию — порядок добавления.
19. **Данные — сотни мелких JSON-файлов** (`profiles/<id>.json`); «коррупция» обрабатывается тихим удалением профиля (`LoadManager` → delProfile). → Единая БД (SQLite) + бэкапы.
20. **Тест UDP/скорости в «Full Test» без прогресса.** Остановить можно только пунктом меню «Stop Testing»; нет прогресс-бара и счётчика оставшихся.
21. **Архивные группы всё ещё в UI.** Archive-группы показываются вкладками, но профили нельзя запускать — состояние неочевидно (нет значка на вкладке).
22. **Двойная семантика Mixed-порта.** Настройка называется «Mixed (SOCKS+HTTP)», а системный прокси Windows использует формат с отдельными http/socks подстановками — путаница при диагностике.
23. **Незадокументированные флаги запуска** (`-many`, `-tray`, `-appdata`, `-debug`, `-flag_reorder`, `-flag_restart_tun_on`) — нужны для пакетов/поддержки, но нигде в UI не описаны.
24. **Ошибки как messagebox-стопки.** Многие ошибки ядра (LoadConfig return error, BuildConfig error) показываются системным messagebox без контекста профиля и без копирования текста.
25. **Группы без статистики.** Трафик считается на профиль; сводки по группе/подписке нет, хотя Subscription-UserInfo уже парсится.

---

## Приложение А. Карта полей настроек DataStore (для паритета LAVRay)

| Группа | Ключи (имена в JSON) |
|---|---|
| Inbound | `inbound_address`, `inbound_socks_port`, `inbound_auth.user/pass`, `custom_inbound` |
| Тесты | `test_url`, `test_url_dl`, `test_dl_timeout`, `test_concurrent` |
| Маршрутизация | `active_routing`, `custom_route` (global), route-set файлы (`direct_ip`, `direct_domain`, `proxy_ip`, `proxy_domain`, `block_ip`, `block_domain`, `def_outbound`, `custom`, DNS-поля, `sniffing_mode`, `domain_strategy`, `outbound_domain_strategy`) |
| Подписки | `user_agent2`, `sub_use_proxy`, `sub_clear`, `sub_insecure`, `sub_auto_update` |
| Запоминание | `remember_id`, `remember_enable`, `spmode2` |
| UI | `theme`, `language`, `mw_size`, `splitter_state`, `start_minimal`, `max_log_line`, `conn_stat`, `log_ignore` (в коде, без persist-имени — сохраняется как `log_ignore`) |
| TUN | `fakedns`, `vpn_internal_tun`, `vpn_impl`, `vpn_mtu`, `vpn_ipv6`, `vpn_hide_console`, `vpn_strict_route`, `vpn_bypass_process`, `vpn_bypass_cidr`, `vpn_rule_white` |
| Хоткеи | `hk_mw`, `hk_group`, `hk_route`, `hk_spmenu` |
| Ядро | `core_box_clash_api`, `core_box_clash_api_secret`, `core_box_underlying_dns`, `extraCore.core_map` |
| Безопасность | `skip_cert`, `utlsFingerprint` |
| Mux | `mux_protocol`, `mux_concurrency`, `mux_padding`, `mux_default_on` |
| Прочее | `sp_format` (system proxy format), `check_include_pre`, `traffic_loop_interval`, `current_group`, `old_share_link_format` (в коде) |

## Приложение Б. Флаги командной строки

| Флаг | Назначение |
|---|---|
| `-tray` | Старт свёрнутым в трей (используется автозапуском) |
| `-many` | Разрешить параллельные инстансы (отключает RunGuard) |
| `-appdata [dir]` | Хранить конфиг в AppConfigLocation/указанном каталоге |
| `-debug` | Отладочный режим (передаётся ядру, verbose-логи) |
| `-flag_restart_tun_on` | Внутренний: перезапуск с включённым TUN после повышения прав |
| `-flag_reorder` | Сервисный: перенумерация id профилей/групп |
| `--` (через launcher) | Аргументы после `--` передаются launcher'у (Linux) |

---

*Документ собран аудитом кода форка (commit `caad794`, ветка `feature/singbox-upgrade`). Все FR ссылаются на конкретные файлы/строки для верификации при проектировании и приёмочном тестировании LAVRay.*
