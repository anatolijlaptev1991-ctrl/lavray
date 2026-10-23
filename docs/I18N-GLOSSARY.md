# LAVRay — глоссарий локализации

Единая терминология для пяти языков (ru, en, zh, es, de). Источник: `docs/fix-plan/03-i18n.md` (разделы 1 и 8, задача A21); на глоссарий ссылается `docs/DESIGN-SYSTEM.md` v1.2 §9. Изменение термина — только через правку этого файла + `design/tools/i18n_check.py`.

## 1. Правила

1. Языки: `ru`, `zh` (упрощённый, материковый Китай), `en`, `es` (Испания), `de` (Германия). Набор ключей во всех словарях одинаковый, кроме форм множественного числа.
2. Обращение: ru — «вы» (со строчной), de — «du», es — «tú», en — нейтрально, zh — нейтрально без 您.
3. Не переводить: LAVRay, LAV Preset RU, LAV Preset CN, имена протоколов (VLESS, VMess, Trojan, Shadowsocks, Hysteria2, TUIC, AnyTLS, WireGuard, SSH, SOCKS5, HTTPS), TUN, TProxy, DNS, DoH, DoT, FakeIP, IPv6, UDP, QR, MTU, User-Agent, HWID, уровни журнала INFO/WARN/ERROR, хосты, IP, имена процессов. Слово «sing-box» в интерфейсе не используется нигде, кроме `lic.core`.
4. Типографика: ru — «ёлочки», неразрывный пробел U+00A0 между числом и единицей («43 мс», «1,2 МБ/с»), перед тире « — » и после однобуквенных предлогов в длинных описаниях; de — „…“ и «Strg» вместо «Ctrl»; es — «…» и ¿…? / ¡…!; en — ’ (U+2019) в сокращениях; zh — полноширинная пунктуация (，。：（）“”), без пробела перед скобками, пробел между иероглифами и латиницей/цифрами.
5. Тексты пишутся с точки зрения пользователя: действия — глаголами («Проверить», «Добавить сервер»), ошибки — что случилось и что сделать, без извинений.
6. Длина: подписи кнопок, вкладок, пунктов навигации и бейджей в es и de — не длиннее en больше чем на 40 %, иначе сократить формулировку (а не обрезать вёрсткой).

## 2. Глоссарий

| ru | en | zh | es | de |
|---|---|---|---|---|
| сервер | server | 服务器 | servidor | Server |
| профиль (запись сервера) | profile | 配置 | perfil | Profil |
| подписка | subscription | 订阅 | suscripción | Abo |
| группа | group | 分组 | grupo | Gruppe |
| подключиться / отключиться | connect / disconnect | 连接 / 断开 | conectar / desconectar | verbinden / trennen |
| режим | mode | 模式 | modo | Modus |
| системный прокси | system proxy | 系统代理 | proxy del sistema | Systemproxy |
| весь трафик | all traffic | 全部流量 | todo el tráfico | gesamter Datenverkehr |
| шлюз | gateway | 网关 | puerta de enlace | Gateway |
| правила | rules | 规则 | reglas | Regeln |
| маршрутизация | routing | 路由 | enrutamiento | Routing |
| пресет | preset | 预设 | preset | Preset |
| встроенный | built-in | 内置 | integrado | integriert |
| через прокси | via proxy | 走代理 | por el proxy | über den Proxy |
| напрямую | direct | 直连 | directo | direkt |
| блокировать | block | 拦截 | bloquear | sperren |
| исходящий | outbound | 出站 | salida | Outbound |
| задержка | latency | 延迟 | latencia | Latenz |
| проверка / проверить | check / test | 检查 / 测试 | comprobación / probar | Prüfung / testen |
| утечка | leak | 泄露 | fuga | Leck |
| соединение | connection | 连接 | conexión | Verbindung |
| журнал | log | 日志 | registro | Protokoll |
| ядро | core | 内核 | núcleo | Core |
| обновление | update | 更新 | actualización | Update |
| откат | rollback | 回退 | reversión | Zurücksetzen |
| канал (обновлений) | channel | 通道 | canal | Kanal |
| ключ, секрет | key | 密钥 | clave | Schlüssel |
| учётные данные | credentials | 凭据 | credenciales | Zugangsdaten |
| трафик (объём) | traffic | 流量 | tráfico | Datenverkehr |
| диагностика | diagnostics | 诊断 | diagnóstico | Diagnose |
| настройки | settings | 设置 | ajustes | Einstellungen |
| служба | service | 服务 | servicio | Dienst |
