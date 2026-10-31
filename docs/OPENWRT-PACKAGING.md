# LAVRay — пакеты OpenWrt: спецификация вне репозитория

Эпик T-76 (Ф7, выпуск 0.9.0). Сопутствующие документы: `docs/OPENWRT-GATEWAY.md` (что делает шлюз), `docs/UPDATE-SYSTEM.md` §6 (обновления и фиды), `docs/THREAT-MODEL.md` §3–§4 (границы доверия панели).

Пакеты **не собираются в этом репозитории**. Их делает репозиторий `lavray-openwrt` (владелец), а отсюда он забирает готовые артефакты. Документ — задание для того репозитория: какие пакеты, какие файлы, какие флаги ядра, как подписываются фиды и что проверить вживую. Места, которые не проверены на настоящем fw4 и SDK, помечены **[проверить]**.

## 1. Что выпускает этот репозиторий

Workflow `release-linux.yml` по тегу `v*` прикрепляет к релизу:

| Ассет | Содержимое |
|---|---|
| `lavray-core-linux-amd64` | ядро для `x86_64`; статический бинарь (`CGO_ENABLED=0`), теги `core/BUILD_TAGS` + `with_webui` |
| `lavray-core-linux-arm64` | то же для `aarch64_*` (cortex-a53, cortex-a72, generic) |
| `ui-dist.tar.gz` | тот же собранный интерфейс отдельным архивом (он уже встроен в бинарь) |
| `SHA256SUMS-linux.txt` | суммы трёх файлов выше; значения `PKG_HASH` берутся отсюда |

`mipsel_24kc` (MT7621, 128 МБ) **не поддерживается**: sing-box с нужными зависимостями для него не собирается (`modernc.org/libc`). Установка на такой роутер обязана заканчиваться понятным сообщением (§4.4), а не обрывом сборки или запуском неработающего бинаря.

Команда сборки панели вручную: `bash scripts/build-webui.sh`, затем `cd core && go build -tags with_webui ./cmd/lavray-core`. Без тега `with_webui` ядро отвечает на `GET /` страницей «веб-панель не встроена».

## 2. Версии OpenWrt и архитектуры

| OpenWrt | Менеджер | Подпись фида |
|---|---|---|
| 24.10 | opkg, `.ipk` | usign (`Packages.sig`) |
| 25.12 и новее | apk, `.apk` | подпись индекса `packages.adb` ключом фида |

Архитектуры первой итерации: `x86_64`; `aarch64_cortex-a53` (MediaTek Filogic: GL.iNet MT3000/MT6000, Xiaomi AX3000T, Cudy), `aarch64_cortex-a72` (Raspberry Pi 4), `aarch64_generic` (armsr-armv8). Один и тот же бинарь `arm64` упаковывается под три метки. Минимум на устройстве: 256 МБ ОЗУ и 64 МБ свободного overlay.

Сборка — в OpenWrt SDK соответствующей версии и цели:

| Цель SDK | Метка пакетов |
|---|---|
| `x86/64` | `x86_64` |
| `mediatek/filogic` | `aarch64_cortex-a53` |
| `bcm27xx/bcm2711` | `aarch64_cortex-a72` |
| `armsr/armv8` | `aarch64_generic` |

## 3. Пакеты

| Пакет | Содержимое | Зависимости |
|---|---|---|
| `lavrayd` | `/usr/bin/lavray-core`, `/etc/init.d/lavrayd`, `/etc/config/lavray`, `/etc/uci-defaults/90-lavrayd`, `/usr/share/nftables.d/ruleset-post/lavray.nft`, `/usr/sbin/lavray-guard`, cron-запись стража | `kmod-tun`, `kmod-nft-tproxy`, `ca-bundle`; система с nftables (fw4) |
| `lavray-webui` | метапакет: тянет `lavrayd`, при установке задаёт адрес панели из `network.lan.ipaddr` и включает TLS. Интерфейс уже **встроен** в бинарь `lavrayd`, отдельных статических файлов в `/www` нет | `lavrayd` |
| `luci-app-lavray` | страница LuCI: статус, ссылка на панель, отпечаток сертификата, переключатель шлюза; бэкенд rpcd со своим ACL | `lavrayd`, `luci-base` |

Пользователь и группа `lavray` создаются пакетом (`PKG_USERID:=lavray=…` в Makefile): на них ссылается правило `meta skuid` в таблице `inet lavray`, поэтому имя должно существовать до применения правил (иначе `nft` не разберёт имя).

### 3.1. Запуск ядра: флаги

| Флаг | Назначение |
|---|---|
| `--listen-socket unix:///var/run/lavray/core.sock` | основной сокет ядра (Bearer-токен) |
| `--token-file /etc/lavray/core.token` | токен ядра из файла (права 0600); у службы нет оболочки, а EOF stdin в этом режиме выходом не считается |
| `--data /etc/lavray/data` | настройки, пользователи панели, сертификат `web-tls.pem` |
| `--headless` | автозапуск последнего профиля и авторестарт |
| `--web-bind <LAN-IP>:<порт>` | веб-панель; адрес — **конкретный LAN-адрес из UCI**, не `0.0.0.0` |
| `--web-allow-remote` | обязателен, если `--web-bind` не на loopback |
| `--web-tls` | HTTPS с самоподписанным ECDSA P-256; отпечаток виден в `GetWebModeStatus` |
| `--platform openwrt` | включает `GatewayService` и режим `GATEWAY_TPROXY` |
| `--gateway-tproxy-port 7893` | порт tproxy-входа |
| `--gateway-ipv6`, `--gateway-dns-hijack` | явное включение IPv6 и перехвата DNS (по умолчанию выключены) |
| `--gateway-watchdog-min 5` | минут без связи до снятия правил |
| `--gateway-fwmark 1` | метка пакетов (§3.4) |
| `--gateway-lan br-lan` | интерфейсы LAN через запятую; остальные не перехватываются |
| `--gateway-user lavray` | пользователь, исключаемый в цепочке `output` |
| `--gateway-state-dir /var/run/lavray` | каталог состояния в tmpfs; сюда пишется `active/lavray.nft` (§3.3) |

Недопустимые сочетания (`--web-bind 0.0.0.0:…` без `--web-allow-remote`, `--web-tls` без `--web-bind`, имя хоста вместо IP) завершают процесс с кодом 2 и сообщением в stderr.

### 3.2. UCI `/etc/config/lavray` и служба procd `lavrayd`

```
config lavray 'main'
	option enabled '0'
	option listen '192.168.1.1:9090'   # --web-bind; uci-defaults подставляет network.lan.ipaddr
	option tls '1'                     # --web-tls
	option tproxy_port '7893'
	option ipv6 '0'
	option dns_hijack '0'
	option watchdog_min '5'
	option fwmark '1'
	option lan 'br-lan'
	option gomemlimit '96MiB'          # GOMEMLIMIT
	option gogc '50'                   # GOGC
```

Скелет `/etc/init.d/lavrayd` (**[проверить]** на 24.10 и 25.12):

```sh
#!/bin/sh /etc/rc.common
USE_PROCD=1
START=95
STOP=10

start_service() {
	config_load lavray
	local enabled listen tls port ipv6 dns wd mark lan memlimit gogc
	config_get_bool enabled main enabled 0
	[ "$enabled" = 1 ] || return 0
	config_get listen main listen
	config_get_bool tls main tls 1
	config_get port main tproxy_port 7893
	config_get_bool ipv6 main ipv6 0
	config_get_bool dns main dns_hijack 0
	config_get wd main watchdog_min 5
	config_get mark main fwmark 1
	config_get lan main lan br-lan
	config_get memlimit main gomemlimit 96MiB
	config_get gogc main gogc 50

	mkdir -p /var/run/lavray/active /etc/lavray/data
	ip rule add fwmark "$mark" lookup 100 priority 100 2>/dev/null
	ip route add local 0.0.0.0/0 dev lo table 100 2>/dev/null
	[ "$ipv6" = 1 ] && {
		ip -6 rule add fwmark "$mark" lookup 100 priority 100 2>/dev/null
		ip -6 route add local ::/0 dev lo table 100 2>/dev/null
	}

	procd_open_instance
	procd_set_param command /usr/bin/lavray-core serve \
		--listen-socket unix:///var/run/lavray/core.sock \
		--token-file /etc/lavray/core.token \
		--data /etc/lavray/data --headless \
		--web-bind "$listen" --web-allow-remote \
		--platform openwrt --gateway-tproxy-port "$port" \
		--gateway-watchdog-min "$wd" --gateway-fwmark "$mark" \
		--gateway-lan "$lan" --gateway-state-dir /var/run/lavray
	[ "$tls" = 1 ] && procd_append_param command --web-tls
	[ "$ipv6" = 1 ] && procd_append_param command --gateway-ipv6
	[ "$dns" = 1 ] && procd_append_param command --gateway-dns-hijack
	procd_set_param env GOMEMLIMIT="$memlimit" GOGC="$gogc"
	procd_set_param respawn 3600 5 5
	procd_set_param stdout 1
	procd_set_param stderr 1
	procd_close_instance
}

stop_service() {
	# Падение или остановка ядра не должны оставлять LAN без интернета.
	nft delete table inet lavray 2>/dev/null
	rm -f /var/run/lavray/active/*.nft
	ip rule del fwmark "$(uci -q get lavray.main.fwmark || echo 1)" lookup 100 2>/dev/null
	ip route flush table 100 2>/dev/null
}

service_triggers() {
	procd_add_reload_trigger lavray
}
```

Токен ядра создаёт `uci-defaults` при первой установке: `umask 077; head -c 36 /dev/urandom | base64 > /etc/lavray/core.token`. Ядро отказывается стартовать, если файл читается группой или остальными или короче 32 символов.

На первой итерации служба работает от `root`: `nft` и tproxy требуют `CAP_NET_ADMIN`, а перехват идёт только в PREROUTING (трафик самого роутера не заворачивается). Целевое усиление — пользователь `lavray` с `CAP_NET_ADMIN`, `CAP_NET_RAW`, `CAP_NET_BIND_SERVICE` через `procd_set_param capabilities` и ujail **[проверить]**.

### 3.3. Include для fw4

Ядро ставит таблицу `inet lavray` само (`nft -f -`), когда запущенный инстанс в режиме шлюза стал `Ready`, и снимает при отключении, падении и выходе. Таблица независима от `inet fw4`, но `fw4 reload` может её сбросить, поэтому рядом лежит include:

`/usr/share/nftables.d/ruleset-post/lavray.nft`:

```
include "/var/run/lavray/active/*.nft"
```

Пока правила активны, ядро держит в `/var/run/lavray/active/lavray.nft` тот же набор, что отдал `nft`; при снятии файл удаляется. Так после `fw4 reload` таблица возвращается, а когда шлюз выключен — каталог пуст и include ничего не делает. **[проверить]**: что fw4 24.10 и 25.12 принимают пустую маску в `include` без ошибки; запасной вариант — хук `/etc/hotplug.d/firewall/90-lavray`, выполняющий `nft -f /var/run/lavray/active/lavray.nft`, если файл есть.

### 3.4. Маршрутизация tproxy

Правила помечают принятые пакеты меткой `fwmark` (по умолчанию 1), а доставку на локальный сокет обеспечивает политика маршрутизации из `start_service` выше (`ip rule … lookup 100` + `ip route add local … dev lo table 100`). Метка и таблица 100 — значения по умолчанию; конфликтующие настройки (mwan3, pbr) владелец пакета разрешает через UCI.

### 3.5. Страж после падения ядра

Процесс ядра не может снять правила, если он убит (`kill -9`, OOM). Нужен внешний страж `/usr/sbin/lavray-guard`, запускаемый cron каждую минуту и из `service_stopped`:

```sh
#!/bin/sh
# Ядра нет, а таблица осталась — LAN без интернета: снять.
pidof lavray-core >/dev/null && exit 0
nft list table inet lavray >/dev/null 2>&1 || exit 0
nft delete table inet lavray
rm -f /var/run/lavray/active/*.nft
logger -t lavray-guard "ядро не запущено: правила nft сняты"
```

При следующем старте ядро само снимает осиротевшие правила (`ClearOrphans`), так что рассинхронизации не остаётся.

### 3.6. `luci-app-lavray`

- `/usr/share/luci/menu.d/luci-app-lavray.json`, `/www/luci-static/resources/view/lavray/status.js` — страница «Сервисы → LAVRay».
- Бэкенд `/usr/share/rpcd/ucode/lavray` читает токен ядра (rpcd работает от root) и вызывает `unix:///var/run/lavray/core.sock`: `GetStatus`, `GetWebModeStatus` (отпечаток сертификата для первой проверки), `GetGatewayStatus`.
- `/usr/share/rpcd/acl.d/luci-app-lavray.json`: группа `read` — статус и отпечаток; группа `write` — только `SetDevicePolicy` и переключение режима шлюза (**отдельная привилегия**).
- Панель нельзя встроить во фрейм: заголовки ядра запрещают это (`frame-ancestors 'none'`), поэтому LuCI показывает ссылку и открывает панель в новой вкладке.

## 4. Сборка и фиды

### 4.1. Makefile пакета `lavrayd` (набросок)

Бинарь готовый, из релиза; в SDK он только упаковывается.

```make
include $(TOPDIR)/rules.mk

PKG_NAME:=lavrayd
PKG_VERSION:=0.9.0
PKG_RELEASE:=1

ifeq ($(ARCH),x86_64)
  LAVRAY_GOARCH:=amd64
  PKG_HASH:=<sha256 из SHA256SUMS-linux.txt>
else ifeq ($(ARCH),aarch64)
  LAVRAY_GOARCH:=arm64
  PKG_HASH:=<sha256 из SHA256SUMS-linux.txt>
endif

PKG_SOURCE:=lavray-core-linux-$(LAVRAY_GOARCH)
PKG_SOURCE_URL:=https://github.com/anatolijlaptev1991-ctrl/lavray/releases/download/v$(PKG_VERSION)
PKG_LICENSE:=GPL-3.0-only

include $(INCLUDE_DIR)/package.mk

define Package/lavrayd
  SECTION:=net
  CATEGORY:=Network
  TITLE:=LAVRay core with web panel and gateway
  DEPENDS:=@(x86_64||aarch64) +kmod-tun +kmod-nft-tproxy +ca-bundle
  USERID:=lavray=:lavray=
endef

define Build/Prepare
	$(CP) $(DL_DIR)/$(PKG_SOURCE) $(PKG_BUILD_DIR)/lavray-core
endef

define Build/Compile
endef

define Package/lavrayd/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/lavray-core $(1)/usr/bin/lavray-core
	# init.d, config, uci-defaults, nftables.d, lavray-guard — из files/
endef

$(eval $(call BuildPackage,lavrayd))
```

### 4.2. Фид ipk (24.10, opkg, usign)

Структура: `https://<хост>/openwrt/24.10/<метка>/packages/` с файлами `*.ipk`, `Packages`, `Packages.gz`, `Packages.sig`.

1. Индекс: `make package/index` в SDK.
2. Подпись: `usign -S -m Packages -s feed.sec -x Packages.sig`.
3. На роутере: открытый ключ в `/etc/opkg/keys/<отпечаток>` (`opkg-key add key.pub`), строка `src/gz lavray https://<хост>/openwrt/24.10/<метка>/packages` в `/etc/opkg/customfeeds.conf`.

### 4.3. Фид apk (25.12+)

Подписанный индекс `packages.adb` (сборка SDK подписывает ключом сборки), открытый ключ — в `/etc/apk/keys/`, адрес индекса — в `/etc/apk/repositories.d/customfeeds.list`. Подпись пакетов обязательна, `--allow-untrusted` в инструкциях не используется. **[проверить]** точные команды на SDK 25.12.

### 4.4. Сообщение для неподдерживаемой архитектуры

`preinst` пакета `lavrayd` проверяет метку архитектуры и при `mipsel_24kc` (и любой не из §2) печатает: «LAVRay не поддерживает архитектуру mipsel_24kc: нужны x86_64 или aarch64 и не менее 256 МБ ОЗУ» — и завершается ошибкой до распаковки файлов.

### 4.5. Кто подписывает фиды

Решение владельца (эпик T-76, вопрос 6) ещё не принято. Рекомендация: ключ фида лежит в секретах GitHub Environment `feed-signing` репозитория `lavray-openwrt` с обязательным ревьюером-владельцем — как `release-signing` для обновлений приложения (`docs/UPDATE-SYSTEM.md` §6). Корневой офлайн-ключ обновлений не переиспользуется. Открытые ключи фидов публикуются в README пакетов и в релизе `lavray`.

## 5. Безопасность развёртывания

- Панель слушает **один** LAN-адрес, не `0.0.0.0` и не WAN/гостевые зоны; ядро не запустится на не-loopback адресе без `--web-allow-remote`.
- Первого администратора создаёт тот, кто первым откроет панель. Открытое окно настройки в LAN — реальный риск: `uci-defaults` не должен включать службу (`enabled '1'`) до того, как владелец готов зайти; `luci-app-lavray` ведёт на панель сразу после включения. Дополнительная защита (одноразовый код настройки) — отдельная задача.
- По HTTP пароль и cookie идут открытым текстом: пакет `lavray-webui` включает TLS по умолчанию; отпечаток сертификата LuCI показывает до первого входа.
- Токен ядра (`core.token`) даёт полный доступ к API в обход пароля; права 0600, ядро проверяет их при старте.
- Статус и логи — в tmpfs (`/var/run/lavray`), чтобы не изнашивать flash; в overlay лежат только настройки, пользователи панели и сертификат.

## 6. Живая проверка Ф7 (ВМ с OpenWrt 24.10)

1. HTTPS: открыть панель по адресу LAN, сверить отпечаток сертификата с тем, что показывает LuCI и `GetWebModeStatus`.
2. Первичная настройка: создать администратора, выйти, войти.
3. Блокировка: 5 неверных паролей подряд — следующий вход закрыт с паузой (`Retry-After`).
4. TProxy для одного MAC: политика «через прокси» для одного устройства LAN, остальные — «напрямую»; проверить `nft list table inet lavray` и публичный IP на каждом.
5. Падение ядра: `kill -9` процесса `lavray-core` — страж снимает правила не позже чем через минуту, интернет у LAN идёт напрямую; после старта службы шлюз возвращается.
6. `fw4 reload` при активном шлюзе: таблица `inet lavray` на месте (include из §3.3).

Автоматические проверки репозитория `lavray`: job CI `nft-check` (golden-правила проходят `nft -c -f`), `web-e2e` (Playwright: вход → список серверов → выход), Go-тесты `internal/web`, `internal/gateway`, `internal/api` и exec-тесты `cmd/lavray-core`.
