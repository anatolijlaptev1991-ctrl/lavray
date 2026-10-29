//! sysproxy — системный прокси ОС (FR-UI-221/222/259).
//!
//! Принцип: перед изменением — снимок текущих настроек в файл рядом с
//! данными; при отключении/падении — откат (не «выключить прокси», а «вернуть
//! как было»). Если приложение упало, следующий старт находит незакрытый снимок
//! и возвращает настройки (teardown-verify).
//!
//! Откат трёхсторонний (T-42): рядом с исходными настройками в снимок
//! записывается то, что стояло сразу после нашего включения. Значение
//! возвращается к исходному, только если сейчас оно такое, какое поставили мы;
//! если за время сессии его изменили пользователь или другая программа, оно
//! остаётся как есть.
//!
//! Windows: WinINET через реестр (Internet Settings) + InternetSetOption
//! (WM_SETTINGCHANGE) — то, что видят Chrome/Edge/системные приложения.
//! Linux: gsettings (GNOME); KDE — kioslaverc (через `kwriteconfig5/6`).
//! macOS: `networksetup -setwebproxy/-setsecurewebproxy`.

use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

/// Снимок предыдущих настроек прокси.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ProxySnapshot {
    /// Версия формата (для будущих миграций).
    pub version: u32,
    /// ОС, где сделан снимок (`windows`/`linux`/`macos`).
    pub os: String,
    /// Параметры, которые надо восстановить (ОС-специфично).
    pub data: serde_json::Value,
}

/// Содержимое файла снимка: настройки «до нас» и «после нас».
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct StoredSnapshot {
    original: ProxySnapshot,
    /// Что стояло сразу после включения. `None` — файл прошлой версии или
    /// включение не дошло до конца: откат безусловный.
    #[serde(default)]
    applied: Option<ProxySnapshot>,
}

/// Итог применения.
#[derive(Debug, Clone)]
pub struct Applied {
    /// Точка выхода прокси, которую увидит система.
    pub host: String,
    pub port: u16,
}

/// Операции над настройками прокси ОС: в приложении — [`System`], в тестах —
/// подставной реестр.
pub trait Backend {
    /// Прочитать текущие настройки.
    fn capture(&self) -> Result<ProxySnapshot, String>;
    /// Включить прокси `host:port`.
    fn apply(&self, host: &str, port: u16) -> Result<(), String>;
    /// Записать настройки из снимка.
    fn restore(&self, snap: &ProxySnapshot) -> Result<(), String>;
}

/// Настоящая ОС.
pub struct System;

impl Backend for System {
    fn capture(&self) -> Result<ProxySnapshot, String> {
        imp::capture()
    }

    fn apply(&self, host: &str, port: u16) -> Result<(), String> {
        imp::apply(host, port)
    }

    fn restore(&self, snap: &ProxySnapshot) -> Result<(), String> {
        imp::restore(snap)
    }
}

/// Операции с прокси идут по одной: ими пользуются и команды UI, и поток
/// надзирателя (снятие прокси при смерти ядра, T-03).
static OPERATIONS: Mutex<()> = Mutex::new(());

fn exclusive() -> MutexGuard<'static, ()> {
    OPERATIONS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Менеджер системного прокси: снимок + применение + откат.
pub struct SysProxy<B: Backend = System> {
    snapshot_path: PathBuf,
    backend: B,
}

impl SysProxy {
    /// Менеджер с файлом снимка в каталоге данных.
    pub fn new(data_dir: &Path) -> Self {
        Self::with_backend(data_dir, System)
    }
}

impl<B: Backend> SysProxy<B> {
    /// Менеджер с подставным бэкендом (тесты).
    pub fn with_backend(data_dir: &Path, backend: B) -> Self {
        Self {
            snapshot_path: data_dir.join("sysproxy.snapshot.json"),
            backend,
        }
    }

    /// Исходные настройки из незакрытого снимка (приложение упало, не успев
    /// их вернуть) — надо откатить ДО нового применения.
    pub fn pending_snapshot(&self) -> Option<ProxySnapshot> {
        self.pending().map(|stored| stored.original)
    }

    fn pending(&self) -> Option<StoredSnapshot> {
        let raw = std::fs::read_to_string(&self.snapshot_path).ok()?;
        serde_json::from_str::<StoredSnapshot>(&raw)
            .ok()
            .or_else(|| {
                // Файл прошлой версии: голый ProxySnapshot без `applied`.
                let original = serde_json::from_str::<ProxySnapshot>(&raw).ok()?;
                Some(StoredSnapshot {
                    original,
                    applied: None,
                })
            })
    }

    fn store(&self, stored: &StoredSnapshot) -> Result<(), String> {
        let raw = serde_json::to_string_pretty(stored).map_err(|e| e.to_string())?;
        // Через временный файл: оборванная запись не оставит полуснимок.
        let tmp = self.snapshot_path.with_extension("json.tmp");
        std::fs::write(&tmp, raw)
            .and_then(|()| std::fs::rename(&tmp, &self.snapshot_path))
            .map_err(|e| format!("snapshot: {e}"))
    }

    /// Вернуть настройки из снимка и удалить его. `Ok(false)` — снимка нет.
    /// При ошибке снимок остаётся: следующая попытка доделает откат.
    fn rollback(&self) -> Result<bool, String> {
        let Some(stored) = self.pending() else {
            return Ok(false);
        };
        let target = match &stored.applied {
            Some(applied) => ProxySnapshot {
                data: three_way(
                    &stored.original.data,
                    &applied.data,
                    &self.backend.capture()?.data,
                ),
                ..stored.original.clone()
            },
            None => stored.original.clone(),
        };
        self.backend.restore(&target)?;
        let _ = std::fs::remove_file(&self.snapshot_path);
        Ok(true)
    }

    /// Восстановить настройки из незакрытого снимка (idempotent).
    pub fn recover_if_needed(&self) -> Result<bool, String> {
        let _guard = exclusive();
        self.rollback()
    }

    /// Включить системный прокси `host:port`, сохранив предыдущее состояние.
    pub fn enable(&self, host: &str, port: u16) -> Result<Applied, String> {
        let _guard = exclusive();
        // Повторное включение при живом снимке: сначала откатываем прошлое.
        // Не вышло — выходим, не трогая файл: в нём настоящие настройки
        // пользователя, а снять новый снимок значило бы стереть их нашими.
        self.rollback()
            .map_err(|e| format!("не удалось вернуть прежние настройки прокси: {e}"))?;
        let original = self.backend.capture()?;
        self.store(&StoredSnapshot {
            original: original.clone(),
            applied: None,
        })?;
        if let Err(e) = self.backend.apply(host, port) {
            return Err(match self.rollback() {
                Ok(_) => e,
                Err(rollback_error) => format!("{e}; откат не удался: {rollback_error}"),
            });
        }
        // То, что стоит сейчас, поставили мы: по этому откат отличит свои
        // значения от чужих. Не записалось — снимок остаётся без `applied`,
        // откат будет безусловным.
        let applied = self.backend.capture().ok();
        let _ = self.store(&StoredSnapshot { original, applied });
        Ok(Applied {
            host: host.to_string(),
            port,
        })
    }

    /// Выключить: вернуть снимок (а не просто «очистить прокси»).
    ///
    /// Без снимка — no-op: значит, прокси включали не мы (или он уже снят),
    /// и стирать настройки пользователя (`clear()`) нельзя. Раньше здесь
    /// стоял `clear()`, из-за чего «Отключить» в приложении выключал
    /// собственный прокси пользователя, выставленный вручную.
    pub fn disable(&self) -> Result<(), String> {
        let _guard = exclusive();
        self.rollback().map(|_| ())
    }

    /// Снять прокси при выходе приложения: восстановить снимок, если он есть.
    /// Отдельный метод, чтобы вызывать его и из команды выхода, и из трея.
    pub fn release_on_quit(&self) -> Result<(), String> {
        self.disable()
    }
}

/// Трёхсторонний откат: запись возвращается к исходной, только если сейчас
/// она такая, какую поставили мы. Иначе её изменил пользователь или другая
/// программа, и она остаётся как есть (A2-05).
fn three_way(original: &Value, applied: &Value, current: &Value) -> Value {
    let (Some(original), Some(applied), Some(current)) = (
        original.as_object(),
        applied.as_object(),
        current.as_object(),
    ) else {
        return original.clone();
    };
    let merged = original
        .iter()
        .map(|(key, old)| {
            let ours = applied.get(key) == current.get(key);
            let value = if ours {
                old.clone()
            } else {
                current.get(key).cloned().unwrap_or(Value::Null)
            };
            (key.clone(), value)
        })
        .collect();
    Value::Object(merged)
}

// ============================================================================
// Windows: значения WinINET (логика без обращения к ОС — проверяется на любой
// платформе)
// ============================================================================

#[cfg(any(windows, test))]
mod wininet {
    use super::ProxySnapshot;
    use serde_json::{json, Value};
    use std::collections::BTreeMap;

    /// Значения Internet Settings, которыми управляет прокси.
    pub(super) const NAMES: [&str; 4] = [
        "ProxyEnable",
        "ProxyServer",
        "ProxyOverride",
        "AutoConfigURL",
    ];
    /// Локальные адреса и типичные внутренние сети — мимо прокси.
    pub(super) const BYPASS: &str =
        "localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;\
        172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;\
        172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>";

    /// Значение реестра: тип и текст так, как их печатает `reg query`.
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub(super) struct RegValue {
        pub kind: String,
        pub data: String,
    }

    impl RegValue {
        pub fn sz(data: impl Into<String>) -> Self {
            Self {
                kind: "REG_SZ".into(),
                data: data.into(),
            }
        }

        pub fn dword(n: u32) -> Self {
            Self {
                kind: "REG_DWORD".into(),
                data: format!("0x{n:x}"),
            }
        }

        fn to_json(&self) -> Value {
            json!({ "type": self.kind, "data": self.data })
        }

        /// Из снимка: `null` (значения нет), объект `{type, data}` или строка
        /// старого формата (число для ProxyEnable, иначе REG_SZ).
        fn from_json(name: &str, value: &Value) -> Result<Option<Self>, String> {
            match value {
                Value::Null => Ok(None),
                Value::String(s) if name == "ProxyEnable" => parse_dword(s)
                    .map(|n| Some(Self::dword(n)))
                    .ok_or_else(|| format!("снимок: {name}: не число: {s}")),
                Value::String(s) => Ok(Some(Self::sz(s.clone()))),
                Value::Object(map) => match (map.get("type"), map.get("data")) {
                    (Some(Value::String(kind)), Some(Value::String(data))) => Ok(Some(Self {
                        kind: kind.clone(),
                        data: data.clone(),
                    })),
                    _ => Err(format!("снимок: {name}: нет type/data")),
                },
                _ => Err(format!("снимок: {name}: неожиданное значение")),
            }
        }
    }

    /// `0x1` (так печатает `reg query`) или `1` → число.
    pub(super) fn parse_dword(text: &str) -> Option<u32> {
        let text = text.trim();
        match text.strip_prefix("0x") {
            Some(hex) => u32::from_str_radix(hex, 16).ok(),
            None => text.parse().ok(),
        }
    }

    /// Значения из вывода `reg query <ключ>`: строки `    Имя    ТИП    данные`.
    /// Данные берутся целиком, с любыми пробелами (раньше значение обрезалось
    /// по первому пробелу, A2-04). Заголовок ключа, имена подразделов и пустые
    /// строки пропускаются.
    pub(super) fn parse_query(output: &str) -> BTreeMap<String, RegValue> {
        let mut found = BTreeMap::new();
        for line in output.lines() {
            let Some(rest) = line.strip_prefix("    ") else {
                continue;
            };
            let mut parts = rest.splitn(3, "    ");
            let (Some(name), Some(kind)) = (parts.next(), parts.next()) else {
                continue;
            };
            if kind.starts_with("REG_") {
                let data = parts.next().unwrap_or("").to_string();
                found.insert(
                    name.to_string(),
                    RegValue {
                        kind: kind.to_string(),
                        data,
                    },
                );
            }
        }
        found
    }

    /// Чтение и запись значений Internet Settings: `reg.exe` или подставной.
    pub(super) trait Registry {
        /// Текущие значения; отсутствующих в карте нет.
        fn read(&self) -> Result<BTreeMap<String, RegValue>, String>;
        fn write(&self, name: &str, value: &RegValue) -> Result<(), String>;
        /// Удаление отсутствующего значения — не ошибка.
        fn remove(&self, name: &str) -> Result<(), String>;
    }

    /// Снимок текущих настроек. ProxyEnable и ProxyServer лежат в одной записи
    /// `proxy`: если ProxyServer сменила другая программа, её ProxyEnable мы
    /// тоже не трогаем.
    pub(super) fn capture_with(reg: &impl Registry) -> Result<ProxySnapshot, String> {
        let found = reg.read()?;
        let get = |name: &str| -> Result<Value, String> {
            match found.get(name) {
                None => Ok(Value::Null),
                Some(v) if matches!(v.kind.as_str(), "REG_SZ" | "REG_EXPAND_SZ" | "REG_DWORD") => {
                    Ok(v.to_json())
                }
                Some(v) => Err(format!(
                    "{name}: тип {} не поддерживается, системный прокси не изменён",
                    v.kind
                )),
            }
        };
        Ok(ProxySnapshot {
            version: 2,
            os: "windows".into(),
            data: json!({
                "proxy": { "ProxyEnable": get("ProxyEnable")?, "ProxyServer": get("ProxyServer")? },
                "ProxyOverride": get("ProxyOverride")?,
                "AutoConfigURL": get("AutoConfigURL")?,
            }),
        })
    }

    pub(super) fn apply_with(reg: &impl Registry, host: &str, port: u16) -> Result<(), String> {
        reg.write("ProxyServer", &RegValue::sz(format!("{host}:{port}")))?;
        reg.write("ProxyOverride", &RegValue::sz(BYPASS))?;
        // PAC-скрипт несовместим с ручным прокси — убираем на время сессии
        // (значение сохранено в снимке и вернётся при выключении).
        reg.remove("AutoConfigURL")?;
        reg.write("ProxyEnable", &RegValue::dword(1))
    }

    /// Записать настройки из снимка (новый формат или плоский старый).
    /// ProxyEnable идёт первым: если запись оборвётся посередине, прокси
    /// останется выключенным, а не включённым с чужим адресом.
    pub(super) fn restore_with(reg: &impl Registry, snap: &ProxySnapshot) -> Result<(), String> {
        for name in NAMES {
            let value = snap
                .data
                .get("proxy")
                .and_then(|group| group.get(name))
                .or_else(|| snap.data.get(name))
                .unwrap_or(&Value::Null);
            match RegValue::from_json(name, value)? {
                Some(v) => reg.write(name, &v)?,
                None => reg.remove(name)?,
            }
        }
        Ok(())
    }
}

#[cfg(windows)]
mod imp {
    use super::wininet::{self, parse_dword, parse_query, RegValue, Registry, NAMES};
    use super::ProxySnapshot;
    use std::collections::BTreeMap;
    use std::os::windows::process::CommandExt;
    use std::path::PathBuf;

    const REG_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings";
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    /// `%SystemRoot%\System32\reg.exe`. Запуск по имени (`Command::new("reg")`)
    /// ищет программу сначала в каталоге приложения: подложенный рядом с
    /// LAVRay.exe `reg.exe` выполнялся бы при каждом включении прокси, а при
    /// запуске от администратора — с повышенными правами (A2-07).
    pub(super) fn reg_exe() -> PathBuf {
        let root = std::env::var_os("SystemRoot")
            .or_else(|| std::env::var_os("windir"))
            .unwrap_or_else(|| r"C:\Windows".into());
        PathBuf::from(root).join("System32").join("reg.exe")
    }

    fn run(args: &[&str]) -> Result<String, String> {
        let out = std::process::Command::new(reg_exe())
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("reg: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "reg {}: {}",
                args.first().unwrap_or(&""),
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    struct RegExe;

    impl Registry for RegExe {
        /// Один `reg query` по ключу вместо четырёх: пока он успешен,
        /// отсутствие имени в выводе значит «значения нет».
        fn read(&self) -> Result<BTreeMap<String, RegValue>, String> {
            let mut all = parse_query(&run(&["query", REG_KEY])?);
            all.retain(|name, _| NAMES.contains(&name.as_str()));
            Ok(all)
        }

        fn write(&self, name: &str, value: &RegValue) -> Result<(), String> {
            let data = if value.kind == "REG_DWORD" {
                parse_dword(&value.data)
                    .ok_or_else(|| format!("{name}: не число: {}", value.data))?
                    .to_string()
            } else {
                value.data.clone()
            };
            run(&[
                "add",
                REG_KEY,
                "/v",
                name,
                "/t",
                &value.kind,
                "/d",
                &data,
                "/f",
            ])
            .map(|_| ())
        }

        fn remove(&self, name: &str) -> Result<(), String> {
            match run(&["delete", REG_KEY, "/v", name, "/f"]) {
                Ok(_) => Ok(()),
                // `reg delete` одинаково падает на «нет значения» и «нет доступа»
                // (текст ошибки зависит от языка ОС): различаем повторным чтением.
                Err(e) if self.read()?.contains_key(name) => Err(e),
                Err(_) => Ok(()),
            }
        }
    }

    /// Уведомить WinINET об изменении (без этого Chrome видит старый прокси).
    fn notify() {
        use windows_sys::Win32::Networking::WinInet::{
            InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED,
        };
        // SAFETY: вызов без параметров (hInternet = null), документирован
        // WinINet: уведомляет систему о смене настроек прокси в реестре.
        unsafe {
            InternetSetOptionW(
                std::ptr::null_mut(),
                INTERNET_OPTION_SETTINGS_CHANGED,
                std::ptr::null_mut(),
                0,
            );
            InternetSetOptionW(
                std::ptr::null_mut(),
                INTERNET_OPTION_REFRESH,
                std::ptr::null_mut(),
                0,
            );
        }
    }

    pub fn capture() -> Result<ProxySnapshot, String> {
        wininet::capture_with(&RegExe)
    }

    pub fn apply(host: &str, port: u16) -> Result<(), String> {
        wininet::apply_with(&RegExe, host, port)?;
        notify();
        Ok(())
    }

    pub fn restore(snap: &ProxySnapshot) -> Result<(), String> {
        wininet::restore_with(&RegExe, snap)?;
        notify();
        Ok(())
    }

    pub fn clear() -> Result<(), String> {
        RegExe.write("ProxyEnable", &RegValue::dword(0))?;
        notify();
        Ok(())
    }
}

// ============================================================================
// macOS: networksetup
// ============================================================================

#[cfg(target_os = "macos")]
mod imp {
    use super::ProxySnapshot;

    fn run(cmd: &str, args: &[&str]) -> Result<String, String> {
        let out = std::process::Command::new(cmd)
            .args(args)
            .output()
            .map_err(|e| format!("{cmd}: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "{cmd}: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    fn active_service() -> Result<String, String> {
        let out = run("networksetup", &["-listallnetworkservices"])?;
        // Первая строка — заголовок; берём первый реальный сервис.
        out.lines()
            .skip(1)
            .map(str::trim)
            .find(|l| !l.is_empty() && !l.starts_with('*'))
            .map(str::to_string)
            .ok_or_else(|| "macOS: не найден сетевой сервис".to_string())
    }

    pub fn capture() -> Result<ProxySnapshot, String> {
        let svc = active_service()?;
        let web = run("networksetup", &["-getwebproxy", &svc]).unwrap_or_default();
        let secure = run("networksetup", &["-getsecurewebproxy", &svc]).unwrap_or_default();
        Ok(ProxySnapshot {
            version: 1,
            os: "macos".into(),
            data: serde_json::json!({
                "service": svc,
                "web": web,
                "secure": secure,
            }),
        })
    }

    pub fn apply(host: &str, port: u16) -> Result<(), String> {
        let svc = active_service()?;
        let p = port.to_string();
        run("networksetup", &["-setwebproxy", &svc, host, &p])?;
        run("networksetup", &["-setsecurewebproxy", &svc, host, &p])?;
        Ok(())
    }

    pub fn restore(snap: &ProxySnapshot) -> Result<(), String> {
        let svc = snap
            .data
            .get("service")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "снимок: нет service".to_string())?
            .to_string();
        for (key, on_flag, off_flag) in [
            ("web", "-setwebproxy", "-setwebproxystate"),
            ("secure", "-setsecurewebproxy", "-setsecurewebproxystate"),
        ] {
            let block = snap
                .data
                .get(key)
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            // networksetup -getwebproxy: "Enabled: Yes\nServer: x\nPort: y"
            let get = |k: &str| {
                block
                    .lines()
                    .find_map(|l| l.trim().strip_prefix(k))
                    .map(|v| v.trim().to_string())
            };
            match (get("Server:"), get("Port:")) {
                (Some(server), Some(port)) if !server.is_empty() => {
                    run("networksetup", &[on_flag, &svc, &server, &port])?;
                    let enabled = get("Enabled:").is_some_and(|v| v.eq_ignore_ascii_case("yes"));
                    run(
                        "networksetup",
                        &[off_flag, &svc, if enabled { "on" } else { "off" }],
                    )?;
                }
                _ => run("networksetup", &[off_flag, &svc, "off"])?,
            }
        }
        Ok(())
    }

    pub fn clear() -> Result<(), String> {
        let svc = active_service()?;
        run("networksetup", &["-setwebproxystate", &svc, "off"])?;
        run("networksetup", &["-setsecurewebproxystate", &svc, "off"])?;
        Ok(())
    }
}

// ============================================================================
// Linux: gsettings (GNOME) / kwriteconfig (KDE)
// ============================================================================

#[cfg(all(unix, not(target_os = "macos")))]
mod imp {
    use super::ProxySnapshot;

    fn gsettings() -> bool {
        std::process::Command::new("gsettings")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn get_gnome(key: &str) -> Option<String> {
        let out = std::process::Command::new("gsettings")
            .args(["get", "org.gnome.system.proxy", key])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    fn set_gnome(schema_key: &str, value: &str) -> Result<(), String> {
        let out = std::process::Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy", schema_key, value])
            .output()
            .map_err(|e| format!("gsettings: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "gsettings set {schema_key}: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(())
    }

    pub fn capture() -> Result<ProxySnapshot, String> {
        if gsettings() {
            return Ok(ProxySnapshot {
                version: 1,
                os: "linux".into(),
                data: serde_json::json!({
                    "backend": "gnome",
                    "mode": get_gnome("mode"),
                    "http_host": get_gnome("http.host"),
                    "http_port": get_gnome("http.port"),
                    "https_host": get_gnome("https.host"),
                    "https_port": get_gnome("https.port"),
                }),
            });
        }
        Ok(ProxySnapshot {
            version: 1,
            os: "linux".into(),
            data: serde_json::json!({"backend": "unsupported"}),
        })
    }

    pub fn apply(host: &str, port: u16) -> Result<(), String> {
        if !gsettings() {
            return Err("системный прокси: поддерживается GNOME/gsettings; \
                        для KDE включите прокси вручную"
                .to_string());
        }
        set_gnome("mode", "'manual'")?;
        set_gnome("http.host", &format!("'{host}'"))?;
        set_gnome("http.port", &port.to_string())?;
        set_gnome("https.host", &format!("'{host}'"))?;
        set_gnome("https.port", &port.to_string())?;
        Ok(())
    }

    pub fn restore(snap: &ProxySnapshot) -> Result<(), String> {
        if !gsettings() {
            return Ok(());
        }
        let d = &snap.data;
        if d.get("backend").and_then(|v| v.as_str()) != Some("gnome") {
            return clear();
        }
        for (key, dv) in [
            ("mode", "mode"),
            ("http.host", "http_host"),
            ("http.port", "http_port"),
            ("https.host", "https_host"),
            ("https.port", "https_port"),
        ] {
            if let Some(v) = d.get(dv).and_then(|v| v.as_str()) {
                let _ = set_gnome(key, v);
            }
        }
        Ok(())
    }

    pub fn clear() -> Result<(), String> {
        if !gsettings() {
            return Ok(());
        }
        set_gnome("mode", "'none'")
    }
}

pub use imp::{apply, capture, clear, restore};

#[cfg(test)]
mod tests {
    use super::wininet::{
        apply_with, capture_with, parse_query, restore_with, RegValue, Registry, BYPASS,
    };
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::collections::BTreeMap;

    /// Реестр в памяти: настоящий реестр и `reg.exe` тесты не трогают.
    #[derive(Default)]
    struct MemRegistry {
        values: RefCell<BTreeMap<String, RegValue>>,
        /// Сколько ближайших записей завершатся ошибкой «Access is denied».
        fail_writes: Cell<u32>,
    }

    impl MemRegistry {
        fn with(rows: &[(&str, &str, &str)]) -> Self {
            let mem = Self::default();
            for (name, kind, data) in rows {
                let value = RegValue {
                    kind: (*kind).into(),
                    data: (*data).into(),
                };
                mem.values.borrow_mut().insert((*name).into(), value);
            }
            mem
        }

        fn dump(&self) -> BTreeMap<String, RegValue> {
            self.values.borrow().clone()
        }

        fn set(&self, name: &str, kind: &str, data: &str) {
            let value = RegValue {
                kind: kind.into(),
                data: data.into(),
            };
            self.values.borrow_mut().insert(name.into(), value);
        }
    }

    impl Registry for MemRegistry {
        fn read(&self) -> Result<BTreeMap<String, RegValue>, String> {
            Ok(self.dump())
        }

        fn write(&self, name: &str, value: &RegValue) -> Result<(), String> {
            if self.fail_writes.get() > 0 {
                self.fail_writes.set(self.fail_writes.get() - 1);
                return Err("reg add: Access is denied".into());
            }
            self.values.borrow_mut().insert(name.into(), value.clone());
            Ok(())
        }

        fn remove(&self, name: &str) -> Result<(), String> {
            self.values.borrow_mut().remove(name);
            Ok(())
        }
    }

    /// Бэкенд поверх реестра в памяти: та же логика, что у настоящего.
    struct Mem<'a>(&'a MemRegistry);

    impl Backend for Mem<'_> {
        fn capture(&self) -> Result<ProxySnapshot, String> {
            capture_with(self.0)
        }

        fn apply(&self, host: &str, port: u16) -> Result<(), String> {
            apply_with(self.0, host, port)
        }

        fn restore(&self, snap: &ProxySnapshot) -> Result<(), String> {
            restore_with(self.0, snap)
        }
    }

    fn fresh_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lavray-sysproxy-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn proxy<'a>(tag: &str, mem: &'a MemRegistry) -> SysProxy<Mem<'a>> {
        SysProxy::with_backend(&fresh_dir(tag), Mem(mem))
    }

    #[test]
    fn snapshot_roundtrip() {
        let snap = ProxySnapshot {
            version: 1,
            os: "test".into(),
            data: serde_json::json!({"ProxyEnable": "0x0", "ProxyServer": "1.2.3.4:8080"}),
        };
        let raw = serde_json::to_string(&snap).unwrap();
        let back: ProxySnapshot = serde_json::from_str(&raw).unwrap();
        assert_eq!(back.data["ProxyServer"], "1.2.3.4:8080");
    }

    #[test]
    fn pending_snapshot_absent_on_clean_dir() {
        let dir = std::env::temp_dir().join(format!("lavray-sysproxy-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let sp = SysProxy::new(&dir);
        assert!(sp.pending_snapshot().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_query_keeps_values_with_spaces() {
        let output = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\r\n\
            \x20   ProxyEnable    REG_DWORD    0x1\r\n\
            \x20   ProxyOverride    REG_SZ    *.corp.local; 10.*;<local>\r\n\
            \x20   Wide    REG_SZ    a    b\r\n\
            \x20   Empty    REG_SZ    \r\n\
            \x20   Path    REG_EXPAND_SZ    %SystemRoot%\\x\r\n\
            \r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\Connections\r\n";
        let found = parse_query(output);
        assert_eq!(
            found["ProxyOverride"],
            RegValue::sz("*.corp.local; 10.*;<local>")
        );
        assert_eq!(found["ProxyEnable"], RegValue::dword(1));
        assert_eq!(found["Wide"].data, "a    b");
        assert_eq!(found["Empty"].data, "");
        assert_eq!(found["Path"].kind, "REG_EXPAND_SZ");
        assert_eq!(found.len(), 5, "заголовки ключей не значения");
    }

    #[cfg(windows)]
    #[test]
    fn reg_program_is_the_absolute_system_reg_exe() {
        let program = imp::reg_exe();
        assert!(program.is_absolute(), "{program:?}");
        assert!(program.ends_with(r"System32\reg.exe"), "{program:?}");
        assert!(program.is_file(), "{program:?}");
    }

    fn initial_corp() -> MemRegistry {
        MemRegistry::with(&[
            ("ProxyEnable", "REG_DWORD", "0x1"),
            ("ProxyServer", "REG_SZ", "corp.proxy:8080"),
            ("ProxyOverride", "REG_SZ", "*.corp.local; 10.*;<local>"),
        ])
    }

    /// A2-04: включить и выключить = ровно прежние настройки, включая пробелы.
    #[test]
    fn enable_then_disable_gives_back_exact_settings() {
        let mem = initial_corp();
        let before = mem.dump();
        let sp = proxy("roundtrip", &mem);
        sp.enable("127.0.0.1", 2080).unwrap();
        assert_eq!(mem.dump()["ProxyServer"], RegValue::sz("127.0.0.1:2080"));
        assert_eq!(mem.dump()["ProxyOverride"], RegValue::sz(BYPASS));
        sp.disable().unwrap();
        assert_eq!(mem.dump(), before);
        assert!(sp.pending_snapshot().is_none());
    }

    /// A2-05: другая программа заняла системный прокси — наш откат её не стирает.
    #[test]
    fn foreign_proxy_set_during_session_is_not_rolled_back() {
        let mem = MemRegistry::with(&[("ProxyEnable", "REG_DWORD", "0x0")]);
        let sp = proxy("foreign", &mem);
        sp.enable("127.0.0.1", 2080).unwrap();
        mem.set("ProxyServer", "REG_SZ", "10.9.9.9:3128");
        sp.disable().unwrap();
        let after = mem.dump();
        assert_eq!(after["ProxyServer"], RegValue::sz("10.9.9.9:3128"));
        assert_eq!(
            after["ProxyEnable"],
            RegValue::dword(1),
            "чужой прокси остался включённым"
        );
    }

    /// Пользователь поправил только список исключений: свой адрес снимаем,
    /// его список оставляем.
    #[test]
    fn user_edit_of_bypass_list_survives_while_our_proxy_is_removed() {
        let mem = MemRegistry::with(&[("ProxyEnable", "REG_DWORD", "0x0")]);
        let sp = proxy("bypass", &mem);
        sp.enable("127.0.0.1", 2080).unwrap();
        mem.set("ProxyOverride", "REG_SZ", "mine.local");
        sp.disable().unwrap();
        let after = mem.dump();
        assert_eq!(after["ProxyOverride"], RegValue::sz("mine.local"));
        assert_eq!(after["ProxyEnable"], RegValue::dword(0));
        assert!(!after.contains_key("ProxyServer"));
    }

    /// Падение приложения с включённым прокси: следующий запуск возвращает
    /// и PAC, и ручной прокси.
    #[test]
    fn crash_then_recover_restores_pac_and_manual_proxy() {
        let mem = MemRegistry::with(&[
            ("ProxyEnable", "REG_DWORD", "0x0"),
            ("AutoConfigURL", "REG_SZ", "http://pac.corp/wpad.dat"),
        ]);
        let before = mem.dump();
        let dir = fresh_dir("crash");
        let first_run = SysProxy::with_backend(&dir, Mem(&mem));
        first_run.enable("127.0.0.1", 2080).unwrap();
        assert!(!mem.dump().contains_key("AutoConfigURL"));
        // «Процесс упал»: disable() не вызывался, новый менеджер видит снимок.
        let second_run = SysProxy::with_backend(&dir, Mem(&mem));
        assert!(second_run.recover_if_needed().unwrap());
        assert_eq!(mem.dump(), before);
    }

    #[test]
    fn double_enable_keeps_the_original_settings() {
        let mem = initial_corp();
        let before = mem.dump();
        let sp = proxy("double", &mem);
        sp.enable("127.0.0.1", 2080).unwrap();
        sp.enable("127.0.0.1", 2081).unwrap();
        sp.disable().unwrap();
        assert_eq!(mem.dump(), before);
    }

    /// A2-15: сбой отката внутри `enable()` не должен ни затирать исходный
    /// снимок, ни продолжать включение.
    #[test]
    fn failed_recovery_inside_enable_keeps_the_original_snapshot() {
        let mem = initial_corp();
        let before = mem.dump();
        let sp = proxy("failed-recovery", &mem);
        sp.enable("127.0.0.1", 2080).unwrap();
        mem.fail_writes.set(1); // первая же запись отката упадёт
        assert!(sp.enable("127.0.0.1", 2080).is_err());
        let kept = sp.pending_snapshot().expect("снимок цел");
        assert_eq!(kept.data["proxy"]["ProxyServer"]["data"], "corp.proxy:8080");
        sp.disable().unwrap();
        assert_eq!(mem.dump(), before);
    }

    /// Снимок прошлой версии (плоский, без `applied`) откатывается безусловно.
    #[test]
    fn snapshot_file_of_the_previous_version_is_restored() {
        let mem = MemRegistry::with(&[
            ("ProxyEnable", "REG_DWORD", "0x1"),
            ("ProxyServer", "REG_SZ", "127.0.0.1:2080"),
        ]);
        let sp = proxy("legacy", &mem);
        let legacy = serde_json::json!({
            "version": 1, "os": "windows",
            "data": {"ProxyEnable": "0x0", "ProxyServer": null, "ProxyOverride": null, "AutoConfigURL": "http://pac.corp/wpad.dat"}
        });
        std::fs::write(&sp.snapshot_path, legacy.to_string()).unwrap();
        assert!(sp.recover_if_needed().unwrap());
        let after = mem.dump();
        assert_eq!(after["ProxyEnable"], RegValue::dword(0));
        assert_eq!(
            after["AutoConfigURL"],
            RegValue::sz("http://pac.corp/wpad.dat")
        );
        assert!(!after.contains_key("ProxyServer"));
    }
}
