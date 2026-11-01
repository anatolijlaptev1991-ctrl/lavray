# Матрица покрытия плана тестирования (части 1 и 2)

Матрица связывает эпики плана доработки (`Ф1.0`, `T-08B`, `T-79`, `T-82`, `T-77`), функции выпусков 0.1.0–0.4.0 и наборы из `docs/TEST-PLAN.md` с файлами этого плана. Часть 2 добавляет эпики T-80, T-83, хвосты A, T-76, T-78 и T-75 (раздел 4). Источник эпиков и имён тестов — план доработки «LAVRay 0.2.1 → 0.9.0» (разделы 2 и 3) и код репозитория: на коммите `97624d6` (часть 1) и на `main` `80be1e9` (часть 2: T-80, T-83, хвосты A, T-76, T-78, T-75).

Обозначения слоёв из плана доработки: GU — Go unit, GF — Go fuzz, GT — Go с тегами и настоящим sing-box, GE — API e2e на клиенте Connect, GC — exec-тест бинаря `cmd/lavray-core`, RU — Rust с подставками, RW — Rust под Windows, VU и VC — vitest (логика и компоненты), CI — скрипт или задание. Классы краевых случаев: H основной, E пустой, B граница, I неверный ввод, C гонка, X отмена/таймаут, R частичный сбой/откат, D идемпотентность, S безопасность, L i18n, A a11y, P платформа.

«Авто» — файлы `auto/`, «Ручн.» — файлы `manual/`. Пустая ячейка означает, что проверки нет в этой части плана.

## 1. Эпики фаз 1 и 2

| Эпик / проверка | Что именно | Авто | Ручн. | Статус |
|---|---|---|---|---|
| **Ф1.0** трещотки и инфраструктура | `size_ratchet.py`, `add-spdx.py`, LF в индексе, `covergate.py` + `coverage.yaml`, тесты скриптов (29), `scripts/smoke/smoke_core.py` | A01 (шаги 8–11), A02 (шаг 8), A07 | | покрыто |
| Ф1.0 `TestMigrationsAreAppendOnly` (миграции v1–v4, хэши) | миграции только добавляются | A02 (шаг 6) | | покрыто |
| Ф1.0 `TestUnimplementedRatchet` | список `allowUnimplemented` только сокращается | A02 (шаг 6) | | покрыто |
| Ф1.0 `TestEveryProcedureHasAgentDecision`, `TestAgentTableKeepsPreviousAllowlists` | решение по агенту для каждой процедуры | A02 (шаг 6), A08 (шаг 5) | | покрыто |
| Ф1.0 UI-подставки (`streamStub`, `tauriStub`) | server-stream Connect, подставной `invoke` | A05 (шаг 6) | | покрыто |
| Ф1.0 ограничения clippy/eslint | clippy `-D warnings`, `eslint --max-warnings=0` | A04 (шаг 4), A05 (шаг 5) | | покрыто |
| **T-08B** хэш custom-полей | `canonjson`, `customhash`, `store` v3, `TestClientCannotSetCustomFieldsConfirmed`, `TestConfirmBindsToHash`, `TestConfirmRaceWithConcurrentEdit`, `TestEditingCustomJSONRevokesConfirmation`, `TestRenameKeepsConfirmation`, `FuzzCanonicalJSON` (GU, GF, GE; H, E, B, I, C, D, S) | A02 (шаги 3, 5, 7), A07 часть В (живой API) | M05 | покрыто |
| T-08B `PreviewCustomFields`, `ConfirmCustomFields`: коды ошибок | `invalid_argument`, `failed_precondition`, `not_found` | A02, A07 часть В | M05 | покрыто |
| T-08B агент: отказ на RPC custom-полей | `deny` в таблице агента | A02 (шаг 6), A08 (`read.denied.*`) | M17 (5.1) | покрыто |
| T-08B UI: окно подтверждения, бейдж, поля | `CustomFieldsDiffDialog.test`, `ProfileEditor`, `no-client-confirmed.test` (VC, VU; A, L) | A05 (шаги 6–7, 10) | M05, M18 (1.16) | покрыто |
| T-08B: неподтверждённый JSON не применяется к подключению | `TestUnconfirmedCustomConfigIsNotMerged` (GE) | A02 | M05 (часть 6) | покрыто |
| **T-79** трекер соединений | `traffic` (`Meter`, `FakeSource`), `FuzzMeterNeverNegative`, покрытие ≥ 90 % (GU, GF) | A02 (шаги 4, 7, 8) | | покрыто |
| T-79 настоящий sing-box | `TestTrafficManagerAvailableViaPlatformWriter`, `TestCloseConnectionClosesRealSocket`, `TestRunnerTrafficNilAfterStop`, `TestRunnerRestartClearsHistory`, `TestTestInstanceCreatesNoCacheFile`, `TestTrafficSourceRace`, `TestRealRunnerConnectionsAndStats` (GT) | A03 (шаги 6, 8) | | покрыто |
| T-79 API: `ListConnections`, `CloseConnection`, `GetTrafficTotals`, `GetTrafficSummary`, `final_stats`, интервалы, фильтры | GE-тесты `internal/api` | A02, A07 часть В | M04 | покрыто |
| T-79 учёт: `sessions` (миграция v4), `AddTraffic`, сброс каждые 30 с, падение ядра | `store`, `traffic_accountant` | A02 | M04 (часть 4) | покрыто |
| T-79 адреса назначения не пишутся в журнал | `TestDestinationsNeverLogged` (на подставке); на живом ядре: (а) собственные сообщения LAVRay (источник не `singbox`: трекер, учёт, статистика, сервис соединений) без адреса назначения — `FAIL`, если найден; (б) строки sing-box `inbound connection to <адрес>` при `log.level = info` ожидаемы, как в NekoBox; после `log.level = warn` и переподключения их нет | A02, A07 (шаг 5: `log.own_messages_have_no_destinations`, `log.level_warn.*`), A09 (раздел 2: в том числе агентский вид журнала и сводка) | | покрыто |
| T-79 UI: экран «Соединения», хуки, история на 1000 | `ConnsScreen.test`, `useConnections.test`, `useTraffic.test` (VC, VU) | A05 | M04 | покрыто |
| T-79 скорость в строке состояния | `useTraffic` | A05 | M04 (часть 1) | покрыто |
| **T-82** настройки оболочки, окно | `prefs_*`, `close_hides_when_close_to_tray`, `start_hidden_by_flag_or_pref`, `geometry_*` (RU) | A04 (шаг 5) | M06 (части 1–2) | покрыто |
| T-82 горячая клавиша | `accel_*`, `hotkey_conflict_reported`, `hotkey_change_unregisters_old_first`, `hotkey_default_off` (RU); `globalHotkey.test`, `GlobalHotkeyRow.test` (VC, VU) | A04, A05 | M06 (часть 5) | покрыто |
| T-82 уведомления | `notify_*` (RU), `notify.test` (VC), текст без имени сервера | A04, A05 | M06 (часть 3) | покрыто |
| T-82 «Сохранить как» | `save_writes_to_the_chosen_path_only`, `cancel_writes_nothing`, `invalid_request_does_not_open_the_dialog`, `write_failure_is_an_io_code` (RU); `saveFile.test` (VU). Реализация проще плана: реестра разрешений на путь (`GrantRegistry`) и чтения файла через оболочку нет, файл открывает `<input type="file">` | A04, A05 | M07, M02 (части 2–3) | покрыто |
| T-82 системный прокси: логика | `ras_connections_receive_proxy`, `wpad_flag_cleared_and_restored`, `snapshot_includes_ras`, `crash_recovery_restores_ras`, `three_way_respects_user_change_on_ras`, `no_ras_entries_ok`, `ras_enum_failure_lan_only_with_warning`, `concurrent_enable_disable_serialized` (RU) | A04 (шаги 5, 7) | | покрыто |
| T-82 системный прокси: настоящий WinINET | `wininet_roundtrip_on_fake_ras_name` (RW) | A04 (шаги 7–9) | | покрыто |
| T-82 системный прокси: вживую (LAN, RAS, WPAD, откат, падение ядра/оболочки, выход) | | A11 | M08, M03 (часть 5), M06 (1.7–1.8) | покрыто |
| T-82 права окна (`capabilities`) и проводка команд | `capabilities.rs`, `main_wiring.rs`, `config_lint.rs` | A04 (шаг 10) | | покрыто |
| T-82 автозапуск: подставная ОС, задача планировщика, хук удаления | `autostart/tests.rs`, `nsis_uninstall_hook_removes_autostart_but_not_on_update` | A04 (шаги 5, 10) | M01 (2.9–2.10), M06 (часть 4) | покрыто |
| T-82 автозапуск и данные при установке/удалении | | A10 (шаги 4, 6, 10) | M01 (части 2–3, 6) | покрыто |
| T-82 перезапуск от администратора, TUN без службы | `elevation.rs`, `launch.rs` (`--elevated-relaunch`, `--wait-pid`) | A04 | M03 (часть 6) | покрыто |
| **T-77** QR: логика | `decodes_generated_qr`, `encode_too_long_throws`, `capture_payload_short_buffer_rejected`, `link_secret_detection` (VU) | A05 | | покрыто |
| T-77 QR: компоненты | `qr_not_found_message`, `paste_image_handled`, `scan_button_only_in_tauri`, `ctrl_q_opens_for_selected_row`, `secret_warning_shown` (VC) | A05 | M02 (часть 3) | покрыто |
| T-77 снимок экрана | `window_restored_even_on_capture_error`, `delay_respected`, `downscale_max_side` (RU); `gdi_capture_nonzero_dimensions` (RW, только на CI) | A04 | M02 (3.9–3.10) | покрыто (RW на ПК не исполняется) |

## 2. Функции выпусков 0.1.0–0.2.1

| Функция | Авто | Ручн. | Статус |
|---|---|---|---|
| Сборщик конфигов, golden-эталоны, проверка настоящим sing-box (`singbox_check`) | A02 (`cfgbuild`), A03 (шаг 9) | | покрыто |
| Туннель на настоящем ядре, REALITY/uTLS, протоколы VLESS, VMess, Trojan, Shadowsocks, Hysteria2, TUIC | A03 (шаг 8, `TestE2E*`), A07 | M03 | покрыто |
| Теги сборки ядра, запрет `clash_api`, имена ассетов | A02 (`buildtags`), A03 (шаги 1, 5), A06 (шаг 8) | | покрыто |
| Парсеры ссылок, подписки, расшифровка ссылок, фаззеры | A02 (шаги 3, 7, 9) | M02 | покрыто |
| Хранилище SQLite, миграции, ошибки открытия базы | A02 (`store`, `cmd/lavray-core`) | | покрыто |
| Запуск ядра: токен в stdin, готовность, выход при EOF | A02 (`cmd/lavray-core`), A03 (шаг 10), A07 | | покрыто |
| Проверка связи после подключения (0.2.1), занятый порт входящего подключения | A03 (`TestHealthCheckRealRunner*`, `TestConnectBusyInboundPortRealRunner`) | M03 (части 2–3) | покрыто |
| MCP: инструменты, режимы, белый список, очистка ответов | A02 (`mcp`), A08 | M17 | покрыто |
| MCP: файл доступа и его права, установка прокси окном при `connect` | A11 (2.4–2.5, часть 3) | M17 (части 2, 4) | покрыто |
| Пресеты (JSON, пять языков), формат и перенос из NekoRay (`FuzzConvertNekoRayRoute`) | A01 (шаг 13), A02 | | покрыто |
| Диагностика «Почему не работает?», проверка утечек | A05 (`screen_diag.test`) | M03 (часть 4) | покрыто |
| Установщик и ZIP: имена, суммы, состав, подпись, размер | A06, A10 | M01 | покрыто |
| Установка поверх, сохранение данных и автозапуска, удаление | A10 | M01 | покрыто |
| Мастер первого запуска | A05 (`onboarding-finish.test`) | M01 (часть 2) | покрыто |
| Настройки: сеть, TUN, kill switch как настройка, тема, акцент, язык | A05 (`screen_settings.*`), A11 (часть Г) | M03 (часть 6), M18 | покрыто (kill switch: только принудительный `strict_route`) |
| Резервная копия настроек (JSON без шифрования) и восстановление | A05 (`screen_settings.backup/restore`) | M07 (часть 3) | покрыто (зашифрованная копия — T-83) |

## 3. Наборы из `docs/TEST-PLAN.md`

| Набор | Где в этой части | Статус |
|---|---|---|
| 1. Oracle-паритет билдера | A02 (`cfgbuild`, golden) | покрыто в части, что есть в `main` |
| 2. `sing-box check` на каждом golden | A03 (шаг 9) | покрыто |
| 3. Фаззинг парсеров | A02 (шаги 7, 9) | покрыто (7 целей, seed-корпуса и короткий прогон) |
| 4. Match-тесты маршрутизации и DNS | A02 (`cfgbuild`, `api`) | покрыто в `go test` |
| 5. Миграция NekoBox → LAVRay | A15, A09 (раздел 7), A02 (Go-тесты `nekoimport`, `FuzzScanEntity`) | покрыто: M10 для интерфейса |
| 6. Безопасность API | A08, A02, A11 (права файла доступа), A04 (capabilities), A09 (агент и коды ошибок), A12 (веб-панель: CSRF, Origin, блокировка, сессии, заголовки, TLS) | покрыто для API ядра, MCP и веб-панели |
| 7. Доступность | A01 (шаг 14 `token_contrast`), A05 (a11y-тесты), M18 | покрыто; NVDA и VoiceOver как ручной чек-лист — M18 (Narrator/NVDA) |
| 8. Локализация | A01 (шаг 14 `i18n_check` прототипа), A05 (шаг 8), M18 | покрыто |
| 9. Сеть и жизненный цикл | A11 (падение ядра и оболочки), M03, M04, M08 | покрыто частично: сон/пробуждение, смена сети, captive portal, IPv6-only, потери и задержки не покрыты |
| 10. Обновления | | TODO фаза 3 (T-75): A13, M12 |
| 11. E2E UI | M01–M09, M11, M13, M16–M18 (ручной прогон); A12 (Playwright-спецификация `web-login.spec.ts` для веб-режима) | tauri-driver не входит; Playwright в A12 запускается отдельным шагом и может быть `BLOCKED` без сети (скачивание браузера) |
| Бюджеты производительности (раздел 2) | размер установщика: A06 (шаг 4), A10 (шаг 7) | остальные бюджеты не измеряются |

## 4. Эпики фаз 3–7

### 4.1 Покрыто частью 2 (первая партия)

| Эпик / проверка | Что именно | Авто | Ручн. | Статус |
|---|---|---|---|---|
| **T-80** наборы маршрутов: ядро | пять встроенных (`lav-ru`, `lav-cn`, `global`, `all-proxy`, `all-direct`); создание из встроенного и из значений; обновление с `expectedRevision`, устаревшая ревизия → `aborted` (409); удаление активного → `newActiveId = global`; `ResetBuiltin` только для копий с источником; лимит 100; `ExportPreset`/`ImportPreset` (встроенный id не принимается, больше 1 МиБ → `resource_exhausted`); `ImportNekoRayRoute` | A09 (раздел 3) | M09 | покрыто |
| T-80 набор применяется в подключении | правила набора входят в конфиг (golden-эталоны сборщика, `singbox_check`); «Проверить маршрут»; изменение активного набора при подключении предлагает перезапуск ядра | A02 (`cfgbuild`), A03 (шаг 9) | M09 (часть 6) | покрыто (живой трафик через правила — только вручную) |
| T-80 редактор: интерфейс | подписи `rt.*`, `toast.preset*`, `conns.rule*`, экран «Правила» | A05 | M09, M18 | покрыто (подписи сверены с `ru.ts` ветки) |
| **T-83** зашифрованная копия: API | формат `LAVBK1`, пароль 8..1024 байт, неверный пароль → `permission_denied` (403), порча → `data_loss` (500), не копия → `invalid_argument` (`backup_not_recognized`), без подтверждения и при подключении → `failed_precondition`, лимит 64 МиБ, агент отказан | A09 (раздел 4) | M11 | покрыто |
| T-83 круг: содержимое | все таблицы построчно, `update.*` не откатываются, идемпотентность, откат при порче, восстановление в пустую базу, секреты в файле не открыты, каждый бит заголовка и тела ломает расшифровку | A14 (блоки 0–6) | M11 (части 3–6) | покрыто |
| T-83 копия от более новой версии | `backup_from_newer_version`, `bk.err.newer` | A14 (шаг 3: Go-тесты репозитория) | | покрыто частично: из скрипта создать такой файл нельзя |
| **Хвосты A**: очистка недоступных | `RemoveUnavailableProfiles(groupId, apply)`: пробный прогон, применение, пропуск активного, ссылок цепочек и непроверенных | A09 (раздел 5) | M13 (часть 1) | покрыто; найденный дефект (очистка считала недоступным только `latency_ms < 0`, а проверка записывает лишь текст ошибки) исправлен в `470d5f2`, три проверки `5.cleanup.*` на сборках до исправления дают `FAIL` |
| Хвосты A: дубликаты | `DeduplicateProfiles`: ключ без имени, остаётся первый, ссылки цепочек переписываются | A09 (раздел 5) | | покрыто |
| Хвосты A: разрешение доменов | `ResolveDomains`: список `failed` с причиной, пустой или более 1000 id → `invalid_argument`, цепочки и IP пропускаются | A09 (раздел 5) | M13 (часть 4, `TODO`) | покрыто API; интерфейс — хвосты B |
| Хвосты A: выгрузка конфига | `ExportConfig` режимы RUN и TEST, без редактирования секретов, внешнее ядро (`naive`) → `failed_precondition` | A09 (раздел 5) | M13 (часть 4, `TODO`) | покрыто API; интерфейс — хвосты B |
| Хвосты A: настройки | `ResetSettings` (неизвестные и внутренние ключи `sub.hwid_id`, `update.*` → `invalid_argument`), `SubscribeSettings` (буфер 16, медленный подписчик отбрасывается), `TestEverySettingHasReader` | A09 (раздел 5, шаг с `go test`), A02 | M13 (часть 2) | покрыто |
| Хвосты A: запоминание профиля | `remember.id`, `remember.modes` пишутся всегда; `remember.enable` разрешает автоподключение службы (`--headless`, `ConnectLast`) | A09 (раздел 6) | M13 (часть 3) | покрыто |
| Хвосты A: CORS | `corsWrap` | A09 (раздел 5) | | покрыто |
| **T-76** веб-панель: привязка | `--web-bind`, строка `LAVRAY_WEB_READY`, внешний адрес только с `--web-allow-remote`, код настройки `web-setup-code` | A12 (разделы 1, 5) | M16 (часть 8) | покрыто; открытие порта наружу — необязательный раздел |
| T-76 первый администратор и вход | пароль не короче 10 символов, единый ответ на неверное имя и пароль, имя без учёта регистра | A12 (раздел 2) | M16 (части 2–3) | покрыто |
| T-76 CSRF, Origin, Bearer | cookie `lavray_session` (`HttpOnly`, `SameSite=Strict`, `Secure` по TLS), `X-Lavray-CSRF`, чужой и «похожий» `Origin` → 403, токен ядра без cookie | A12 (раздел 2) | M16 (2.6, 6.3) | покрыто |
| T-76 блокировка | пауза с 5-й неудачи (1, 2, 4, 8, 16 с), блок на 15 минут с 10-й, по учётной записи | A12 (раздел 2) | M16 (3.5–3.8) | покрыто; пределы по адресу и общий — только Go-тесты `core/internal/web` (A02), вживую не проверяются |
| T-76 сессии | не более 64 на пользователя, простой 12 ч, абсолютный срок 7 суток, отзыв, смена пароля отзывает остальные | A12 (раздел 2: значения сроков из `GetWebModeStatus`, вытеснение 65-й); сроки по часам — Go-тест `TestSessionIdleAndAbsoluteTTL` (A02) | M16 (часть 5) | покрыто |
| T-76 TLS и заголовки | самоподписанный ECDSA P-256, отпечаток `AA:BB:…`, сертификат стабилен между запусками; CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, COOP/CORP, `Permissions-Policy`, без HSTS | A12 (разделы 2–3) | M16 (часть 7) | покрыто |
| T-76 без панели и шлюз | без `--web-bind` `WebSessionService` → `unimplemented`; `GatewayService` на настольной платформе → `invalid_argument` (`--platform openwrt`) | A12 (раздел 4) | | покрыто; правила `nft` и watchdog шлюза — только CI Linux |
| T-76 интерфейс панели | экраны первичной настройки и входа, баннер «Не защищено», скрытые функции оболочки, сессии и смена пароля; `web-login.spec.ts` | A05, A12 (Playwright) | M16 | покрыто |
| **T-78** перенос из NekoBox: поиск | `DetectNekoBox`: переданные пути (`manual`), `%APPDATA%`/`%LOCALAPPDATA%` (`appdata`, `localappdata`), `config` рядом с запущенным `nekobox.exe` (`process`), дубли, относительные и несуществующие пути игнорируются, `looksRunning` | A15 (блок 1), A09 (раздел 7) | M10 (части 1, 3) | покрыто |
| T-78 предпросмотр и перенос | `PreviewNekoBoxImport` = `ImportNekoBox` без записи; одна транзакция; группы в порядке `pm.json`, порядок профилей из `order`, цепочка, `front_proxy_id`, подписка, custom-поля без подтверждения, отчёт о потерях (`skipped` с причинами); каталог NekoBox не меняется; в отчёте и журнале нет секретов | A15 (блоки 2, 3), A09 (раздел 7) | M10 (часть 2) | покрыто |
| T-78 идемпотентность и коллизии | ключ «id + тип + адрес» (`import_map`): `alreadyPresent`, возврат удалённой локально записи, тот же id с другим содержимым — новая запись; чужие данные LAVRay целы, перенумерация (`renumbered`), переписывание цепочек, `front_proxy_id` и ссылок в настройках, группа с id 0, звено цепочки и группа, которых нет | A15 (блоки 3–5) | M10 (части 4, 5) | покрыто |
| T-78 маршруты и настройки | `routes_box/` → `custom:neko-<slug>`, `nekoboxActiveRoute`, битый маршрут не фатален; таблица соответствия настроек с валидатором `SetSettings`, `update.*` не пишется никогда | A15 (блоки 6, 7) | M10 (часть 2) | покрыто |
| T-78 пределы и безопасность чтения | 20 000 файлов, 64 МиБ, 2 МиБ на файл; символические ссылки и не обычные файлы не читаются; параллельный перенос → `aborted`; агент отказан в `read` и `control`; коды путей | A15 (блоки 2, 8–10), A09 (раздел 7) | M10 (часть 7) | покрыто; символические ссылки — только при праве на их создание (иначе `WARN` и Go-тест `SKIP`) |
| T-78 командная строка | `lavray-core import-nekobox --data D --from P [--dry-run --no-routes --no-settings]`: коды выхода 0, 1, 2; сухой прогон оставляет файлы базы побайтно прежними | A15 (блок 11) | | покрыто (наблюдение `minor` «неудачный перенос оставляет пустую `lavray.db`» исправлено в `470d5f2`) |
| T-78 интерфейс | плитка мастера («Найдено: …»), строка в «Настройках», окно (путь, «Выбрать папку…», кандидаты, галочки, предпросмотр, «NekoBox сейчас запущен…», отчёт, «Включить маршрут из NekoBox») | A05 (`NekoBoxImportDialog.test`, `NekoBoxTile.test`, `NekoBoxRow.test`, `nekoBox.test`) | M10 | покрыто (подписи сверены с `ru.ts`; в плане владельца кнопка названа «Сделать активным», в словаре — «Включить маршрут из NekoBox») |
| **T-75** центр обновлений: цепочка доверия | корень → timestamp → manifest; подписи, `expires`, окно свежести 7 суток + допуск часов (`clock_skew`), `product`, `channel`; монотонные `serial` и версия timestamp; mix-and-match (sha256 манифеста закреплён в timestamp); причины `not_configured`, `bad_signature`, `expired`, `serial_rollback`, `wrong_product`, `wrong_channel`, `root_rotation`, `artifact_role_missing`, `mirror_unreachable` | A13 (разделы 1, 3, 4, 11), A09 (раздел 8) | M12 (части 2–5) | покрыто на **тестовом корне**; настоящий корень — заглушка до церемонии ключей (M12 часть 12) |
| T-75 ротация корня | `N → N+1` подписью порога прежних ключей, отзыв ключей timestamp и manifest со сбросом счётчиков, подделка корня, корень без роли `artifact`, подложенный в каталог данных корень | A13 (раздел 5), Go-тесты `internal/updates` (A13 шаг 4) | | покрыто |
| T-75 загрузка и транспорт | `DownloadUpdates` в `staging` (`<sha256>-<имя>`, `.part`, `Range`, минимум два источника), лимит 8 МиБ, редиректы только на `https`, обрыв и докачка, подмена байта, чужой ключ artifact, одна загрузка за раз | A13 (разделы 2, 6, 7) | M12 (3.4–3.6) | покрыто; редирект `https → http` — Go-тест `TestHttpsToHttpRedirectRejected` (зеркала теста — обычный HTTP) |
| T-75 «Установить из файла» и `verify-artifact` | `VerifyLocalUpdate` (только staging, подпись рядом или из манифеста, продукт, платформа, версия новее), подкоманда `lavray-core verify-artifact` (коды 0, 1, 2, `--allow-older`) | A13 (разделы 8, 9) | M12 (часть 6) | покрыто |
| T-75 служебные настройки | `update.*` клиент не пишет и не читает, `update.channel` и `update.auto_check` — пользовательские; `GetUpdateState`: `rootVersion`, `maxSerial`, `timestampFresh` | A13 (раздел 4), A09 (раздел 8) | M12 (часть 4) | покрыто; наблюдение `minor`: `update.channel` не проверяет значение |
| T-75 workflow подписи | `meta-refresh`, `meta-resign`, `release-windows`: права, Environment, запрет `${{ inputs.* }}` в `run:` (12 тестов) | A13 (шаг 3) | | покрыто статически; запуск workflow с настоящими ключами — после церемонии |
| T-75 экран «Обновления» | состояние, «последняя проверка N дней назад» (предупреждение с 7-х суток, красный с 30-х), канал beta с подтверждением, заметки только текстом, автопроверка, «Установить из файла…» | A05 (`UpdatesScreen.test`, `updates.dictionary.test`) | M12 (части 2–6) | покрыто (подписи сверены с `ru.ts`; щелчки не прогонялись) |
| T-75 установка, откат, сторож (оболочка) | UAC и `uac_cancelled`, `sha256_mismatch`/`signature_invalid`/`version_mismatch`/`core_unavailable`, копия старого exe и ожидание `health.json` 60 с, откат прошлым установщиком, замок `installer_locked` и **опыт на ВМ с запретом записи** | A04 (Rust-тесты `shell/src/update`) | M12 (части 7–11) | покрыто ручным файлом на ВМ; результат опыта записывается в отчёт |
| Таблицы агента (`deny`/`read`/`control`) | `TestEveryProcedureHasAgentDecision`, `TestAgentTableKeepsPreviousAllowlists`; отказ агенту для RPC наборов, копии, экспорта конфига, сброса, подписки на настройки и всего `MigrationService` | A02 (шаг 6), A09 (разделы 3–5, 7, 8, К6, К8, К9), A08, A13 (раздел 10), A15 (блок 10) | | покрыто для влитых RPC; RPC хвостов B — TODO |
| Миграции (`web_users`, `sessions`, `import_map`), `TestMigrationsAreAppendOnly` | таблицы только добавляются; число строк по каждой таблице после восстановления; `import_map` без повторов и с целыми внешними ключами после параллельного переноса | A02 (шаг 6), A14, A15 (блок 9) | | покрыто |

### 4.2 Ждут слияния (TODO)

| Эпик | Фаза / выпуск | Планируемые файлы | Статус |
|---|---|---|---|
| Хвосты B: интерфейс для неиспользуемых RPC (очистка, дубликаты, разрешение доменов, выгрузка конфига, сброс настроек), правая панель «Подключение», полный kill switch («не снимать прокси при падении ядра»), бейдж XHTTP, пресеты и geo через апдейтер | Ф6 / 0.8.0 | M14, M15, часть 4 в M13, A09, A13 | TODO |
| Новые таблицы агента для RPC T-75, T-78 и хвостов B | каждая фаза | A02, A08, A09 | TODO |

## 5. Что не покрыто в части 1 и почему

| Область | Причина |
|---|---|
| Производительность (старт окна, память, CPU) | нет измерителя в `main`; бюджеты — в `docs/TEST-PLAN.md` |
| Сон/пробуждение, смена сети Wi-Fi/Ethernet, captive portal, IPv6-only, потери пакетов | требуют стенда и toxiproxy (набор 9) |
| macOS, Linux, OpenWrt | текущий выпуск — только Windows |
| Authenticode-подпись установщика | сборки 0.4.0 не подписаны; A06 фиксирует состояние |
| Полная блокировка трафика при падении туннеля (WFP) | не реализована (исследование R-1 плана) |
| Транспорт XHTTP | нет в форке sing-box (исследование R-2) |
| `gdi_capture_nonzero_dimensions` (RW) | выполняется в CI на одноразовом раннере, на ПК запускается только как часть `cargo test` без гарантии наличия экрана |
