// SPDX-License-Identifier: GPL-3.0-only

// rpc-unused.allow.ts — RPC из proto/lavray.proto, которые интерфейс окна сейчас не
// вызывает, и почему. Остальные RPC обязаны вызываться в ui/src (scripts/rpc_usage.py
// и rpc-usage.test.ts). Список только уменьшается: стоит RPC начать вызывать — запись
// надо удалить, иначе проверка упадёт (устаревшее исключение скрывало бы регресс).
// Причина описывает состояние окна, а не чужих клиентов: кто ещё вызывает RPC (агенты,
// веб-панель), здесь не утверждается. Формат записи — одна строка `'Сервис/Метод': 'причина',`.

export const RPC_UNUSED_ALLOWED: Readonly<Record<string, string>> = {
  // ---- Окну хватает других RPC ----
  'CoreService/SubscribeEvents': 'окно опрашивает GetStatus раз в секунду и поток событий ядра не использует',
  'ProfileService/GetProfile': 'профили приходят целиком в ListProfiles; одиночное чтение окну не нужно',
  'RoutingService/GetPreset': 'окно читает наборы целиком через ListPresets',
  'RoutingService/GetActivePreset': 'активный набор окно берёт из ListPresets.active_preset_id',
  'LogService/GetTail': 'окно получает журнал потоком Subscribe, разовый хвост не запрашивает',
  'StatsService/GetTrafficTotals': 'накопленный трафик профилей окно берёт из ListProfiles (Profile.traffic)',
  'ConnectionService/ListConnections': 'таблица соединений идёт потоком WatchConnections, разовый снимок не запрашивается',
  'SubscriptionService/UpdateSubscriptionSettings': 'настройки подписки окно сохраняет через UpdateGroup (SubscriptionSettingsDialog)',

  // ---- Действий в окне пока нет ----
  'CoreService/Shutdown': 'остановку ядра выполняет оболочка (shell/src/coreproc), окно ядро не гасит',
  'ProfileService/ReorderProfiles': 'ручного порядка серверов в дизайне окна нет: список сортируется по задержке или имени',
  'ProfileService/ClearTestResults': 'кнопки очистки результатов тестов в окне пока нет: следующая проверка перезаписывает значения',
  'ProfileService/ReorderGroups': 'перетаскивания вкладок групп в окне пока нет',
  'SettingsService/ResetSettings': 'кнопки «Сбросить настройки» в окне ещё нет (RPC появился в хвостах A)',
  'RoutingService/ImportNekoRayRoute': 'отдельной кнопки импорта маршрута NekoRay в окне нет: маршруты NekoBox переносит мастер миграции (MigrationService)',

  // ---- Центр обновлений (T-75) ----
  'UpdateService/Rollback': 'откат приложения идёт командой оболочки update_rollback (useRollback), ядро в откате не участвует; RPC окно не вызывает',

  // ---- Шлюз OpenWrt и веб-панель (T-76) ----
  'GatewayService/GetGatewayStatus': 'шлюз OpenWrt: на десктопе методы шлюза отвечают INVALID_ARGUMENT, экрана шлюза в окне нет',
  'GatewayService/ListDevicePolicies': 'шлюз OpenWrt: политики устройств есть только на роутере, экрана в окне нет',
  'GatewayService/SetDevicePolicy': 'шлюз OpenWrt: политики устройств есть только на роутере, экрана в окне нет',
  'WebSessionService/RenewSession': 'веб-панель (T-76) пока не вызывает RenewSession: простой сессии 12 ч, предел 7 суток, при истечении страница просит войти заново',
};
