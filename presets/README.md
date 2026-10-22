# presets/ — маршрутные пресеты LAVRay

Встроенные (зашитые в сборку) и поставляемые пресеты маршрутизации.

## Состав

- `lav-ru.source.json` — исходник пресета «LAV Preset RU» (копия файла `RU-bypass + Games`
  из репозитория `nekobox-ru-bypass-games`, формат NekoRay 4.x). В сборку попадает
  сконвертированный `lav-ru.json` (формат LAVRay) — см. `../docs/PRESET-LAV-RU.md`:
  RU-сайты и игры напрямую, AI/Dev-домены через прокси, раздельный DNS.

## Формат пресетов LAVRay

- JSON-схема с полем `version` (схема) и `revision` (данные пресета; monotonically increasing).
- Надмножество ключей формата NekoRay 4.x (`custom`, `def_outbound`, `direct_domain`,
  `proxy_domain`, `direct_ip`, `direct_dns`, `remote_dns`, `dns_final_out`, `dns_routing`,
  `sniffing_mode`) + расширения LAVRay: platform-scoped правила (`process_name` для
  Windows/macOS/Linux; на OpenWrt опускаются с предупреждением в UI), локализуемые имя/описание.
- Версионирование: изменение данных = `revision + 1`; «Центр обновлений» умеет обновлять
  пресеты независимо от версии приложения; пользовательские правки никогда не перезаписываются
  молча — предлагается diff/merge (`../docs/UPDATE-SYSTEM.md`).

## Конвертер из NekoRay 4.x

Конвертер пишется один раз в ядре (`../core/`), покрывается тестами; `lav-ru.source.json`
используется как эталонный тест-вектор (golden-тест конвертации в конфиг sing-box, тест
приоритетов: `google.ru` → proxy, `lori.ru` → direct, LoL-процесс → direct; fuzzing входа).

## Регламент изменений

Изменение пресета = PR в этот репозиторий + обновление `revision` + прогон golden-тестов
ядра. Домены AI-сервисов меняются часто — пресет обновляется чаще релизов приложения.
