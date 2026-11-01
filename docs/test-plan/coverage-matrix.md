# Матрица покрытия плана тестирования (часть 1: версия 0.4.0)

Матрица связывает эпики плана доработки (`Ф1.0`, `T-08B`, `T-79`, `T-82`, `T-77`), функции выпусков 0.1.0–0.4.0 и наборы из `docs/TEST-PLAN.md` с файлами этого плана. Источник эпиков и имён тестов — план доработки «LAVRay 0.2.1 → 0.9.0» (разделы 2 и 3) и код репозитория на коммите `97624d6`.

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
| T-79 адреса назначения не пишутся в журнал | `TestDestinationsNeverLogged` (на подставке) | A02 | | покрыто частично: на живом ядре строки sing-box с адресами попадают в журнал (A07, `WARN log.destinations_not_logged`) |
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
| 5. Миграция NekoBox → LAVRay | | TODO фаза 4 (T-78): A15, M10 |
| 6. Безопасность API | A08, A02, A11 (права файла доступа), A04 (capabilities) | покрыто для API ядра и MCP; веб-панель — TODO фаза 7 |
| 7. Доступность | A01 (шаг 14 `token_contrast`), A05 (a11y-тесты), M18 | покрыто; NVDA и VoiceOver как ручной чек-лист — M18 (Narrator/NVDA) |
| 8. Локализация | A01 (шаг 14 `i18n_check` прототипа), A05 (шаг 8), M18 | покрыто |
| 9. Сеть и жизненный цикл | A11 (падение ядра и оболочки), M03, M04, M08 | покрыто частично: сон/пробуждение, смена сети, captive portal, IPv6-only, потери и задержки не покрыты |
| 10. Обновления | | TODO фаза 3 (T-75): A13, M12 |
| 11. E2E UI | M01–M08, M17, M18 (ручной прогон) | Playwright для веб-режима и tauri-driver не входят; TODO фаза 7 (A12, M16) |
| Бюджеты производительности (раздел 2) | размер установщика: A06 (шаг 4), A10 (шаг 7) | остальные бюджеты не измеряются |

## 4. Строки для фаз 3–7 (заполняются при добавлении файлов)

| Эпик | Фаза / выпуск | Планируемые файлы | Статус |
|---|---|---|---|
| T-75 центр обновлений (корни доверия, `updsign`, `minisign`, загрузка, откат, установка из файла) | Ф3 / 0.5.0 | A13, M12, дополнения A10 (тихая установка обновления), A09 | TODO |
| T-80 редактор наборов маршрутов (создание, копия, сброс, импорт и экспорт) | Ф4 / 0.6.0 | A09, M09 | TODO |
| T-78 перенос из NekoBox (`Detect`, `Preview`, `Import`, идемпотентность, коллизии id) | Ф4 / 0.6.0 | A15, A09, M10 | TODO |
| T-83 зашифрованная резервная копия (Argon2id, XChaCha20-Poly1305, восстановление целиком) | Ф5 / 0.7.0 | A14, A09, M11 | TODO |
| Хвосты A (ядро): `RemoveUnavailable`, `Deduplicate`, `ResolveDomains`, `ExportConfig`, `ResetSettings`, `SubscribeSettings` | Ф5 / 0.7.0 | A09, M13 | TODO |
| Хвосты B: UI для неиспользуемых RPC, правая панель «Подключение», полный kill switch («не снимать прокси при падении ядра»), бейдж XHTTP, пресеты и geo через апдейтер | Ф6 / 0.8.0 | M14, M15, A09, A13 | TODO |
| T-76 веб-панель и шлюз OpenWrt (`--web-bind`, первый администратор, вход, CSRF, блокировка, TLS) | Ф7 / 0.9.0 | A12, M16 | TODO |
| Новые таблицы агента (`deny`/`read`/`control`) для RPC фаз 3–7 | каждая фаза | A02, A08 (расширение набора `read.denied.*`) | TODO |
| Миграции v5 (`import_map`), v6 (`web_users`) | Ф4, Ф7 | A02 (`TestMigrationsAreAppendOnly`), A14, A15 | TODO |

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
