// SPDX-License-Identifier: GPL-3.0-only

// rpc-unused.allow.ts — RPC из proto/lavray.proto, которые интерфейс окна намеренно
// не вызывает, и почему. Остальные RPC обязаны вызываться в ui/src (scripts/rpc_usage.py
// и rpc-usage.test.ts). Список только уменьшается: стоит RPC начать вызывать — запись
// надо удалить, иначе проверка упадёт (устаревшее исключение скрывало бы регресс).
// Формат одной записи — одна строка `'Сервис/Метод': 'причина',`.

export const RPC_UNUSED_ALLOWED: Readonly<Record<string, string>> = {
  // ---- Только для агентов (MCP) и headless: окну хватает других RPC ----
  'CoreService/SubscribeEvents': 'окно опрашивает GetStatus раз в секунду; поток событий ядра нужен веб-панели (Ф7) и агентам',
  'ProfileService/GetProfile': 'профиль целиком приходит в ListProfiles; одиночное чтение нужно агентам (MCP) и headless',
  'RoutingService/GetPreset': 'наборы окно читает целиком через ListPresets; одиночное чтение нужно агентам',
  'RoutingService/GetActivePreset': 'активный набор окно берёт из ListPresets.active_preset_id; отдельный запрос нужен агентам',
  'LogService/GetTail': 'окно получает журнал потоком Subscribe; хвост за раз нужен агентам и headless',
  'StatsService/GetTrafficTotals': 'накопленный трафик профилей окно берёт из ListProfiles (Profile.traffic); отдельный запрос нужен агентам',
  'ConnectionService/ListConnections': 'таблица соединений идёт потоком WatchConnections; одноразовый снимок нужен агентам',
  'SubscriptionService/UpdateSubscriptionSettings': 'настройки подписки окно сохраняет через UpdateGroup (SubscriptionSettingsDialog); этот RPC нужен агентам',

  // ---- Действия, которых в дизайне окна нет ----
  'CoreService/Shutdown': 'остановку ядра выполняет оболочка (shell/src/coreproc); окно ядро не гасит',
  'ProfileService/ReorderProfiles': 'ручного порядка серверов в дизайне нет: список сортируется по задержке или имени',
  'ProfileService/ClearTestResults': 'отдельной очистки результатов тестов в дизайне нет: следующая проверка перезаписывает значения',
  'ProfileService/ReorderGroups': 'перетаскивания вкладок групп в дизайне нет: порядок задаёт ядро при создании группы',
  'SettingsService/ResetSettings': 'кнопки «Сбросить настройки» в интерфейсе ещё нет; RPC добавлен в хвостах A и пока доступен агентам',
  'RoutingService/ImportNekoRayRoute': 'импорт маршрутов NekoRay получит интерфейс вместе с переносом данных NekoBox (T-78)',

  // ---- Центр обновлений: достраивается отдельной веткой (T-75) ----
  'UpdateService/ApplyUpdates': 'установку обновлений выполняет апдейтер оболочки (T-75, отдельная ветка)',
  'UpdateService/Rollback': 'откат компонента выполняет апдейтер оболочки (T-75, отдельная ветка)',
  'UpdateService/VerifyLocalUpdate': 'проверка локального пакета обновления входит в T-75 (отдельная ветка)',

  // ---- Шлюз OpenWrt и веб-панель (T-76) ----
  'GatewayService/GetGatewayStatus': 'шлюз OpenWrt (T-76): на десктопе все методы шлюза отвечают INVALID_ARGUMENT',
  'GatewayService/ListDevicePolicies': 'шлюз OpenWrt (T-76): политики устройств есть только на роутере',
  'GatewayService/SetDevicePolicy': 'шлюз OpenWrt (T-76): политики устройств есть только на роутере',
  'WebSessionService/RenewSession': 'веб-панель (T-76) пока не вызывает RenewSession: простой сессии 12 ч, предел 7 суток, при истечении страница просит войти заново',
};
