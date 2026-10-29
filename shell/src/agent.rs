// SPDX-License-Identifier: GPL-3.0-only

//! Доступ ИИ-агентов (MCP): файл `agent-endpoint.json` (решение владельца
//! 2026-10-29).
//!
//! На каждый запуск ядра оболочка генерирует отдельный агентский токен (32 байта
//! CSPRNG) и передаёт его ядру второй строкой stdin рядом с основным токеном —
//! в командной строке процесса его нет. Пока доступ включён, рядом с данными
//! приложения лежит файл `{url, token, mode}`, по которому `lavray-core mcp`
//! находит ядро. Основной токен ядра в файл не попадает никогда.
//!
//! Файл читает только его владелец: на Windows создаётся с явным защищённым
//! дескриптором (`D:P(A;;FA;;;<SID пользователя>)(A;;FA;;;SY)`: пользователь и
//! SYSTEM, без наследования от каталога), на Unix — с правами 0600. Без SID
//! пользователя файл не создаётся вовсе.
//!
//! Файл существует только пока выполнены все условия: режим не `off`, ядро
//! запущено, приложение не завершается. Остановка ядра, выход, выключение
//! доступа и падение ядра удаляют его; файл, оставшийся от аварийно закрытого
//! приложения, удаляется при следующем запуске.
//!
//! Режим хранится в настройке ядра `agent.mode` (ядро применяет его сразу). Окно
//! читает настройку и сообщает оболочке командой `agent_access_set`: при каждой
//! загрузке и при каждом изменении. Файл перезаписывается без перезапуска ядра.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

/// Имя файла в каталоге данных приложения.
pub const FILE_NAME: &str = "agent-endpoint.json";

/// Сколько раз повторять запись и удаление файла, если его в этот момент читает
/// `lavray-core mcp` (Go открывает файлы без права удаления на время чтения).
const IO_ATTEMPTS: u32 = 8;
const IO_PAUSE: Duration = Duration::from_millis(25);

/// Режим доступа агентов (значения настройки `agent.mode`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AgentMode {
    /// Доступа нет (по умолчанию).
    #[default]
    Off,
    /// Только чтение: состояние, список серверов, трафик, журнал.
    Read,
    /// Чтение и управление: подключение, тест серверов, обновление подписок.
    Control,
}

impl AgentMode {
    /// Разбор значения настройки; незнакомое значение — `None`.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "off" => Some(Self::Off),
            "read" => Some(Self::Read),
            "control" => Some(Self::Control),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Read => "read",
            Self::Control => "control",
        }
    }
}

/// Дескриптор безопасности файла: только пользователь и SYSTEM, наследование от
/// каталога отключено (`P`).
pub fn sddl(sid: &str) -> String {
    format!("D:P(A;;FA;;;{sid})(A;;FA;;;SY)")
}

/// Содержимое файла.
pub fn endpoint_json(url: &str, token: &str, mode: AgentMode) -> String {
    serde_json::json!({ "url": url, "token": token, "mode": mode.as_str() }).to_string()
}

/// Ядро, которое сейчас запущено: адрес и агентский токен этого запуска.
struct Core {
    url: String,
    token: String,
}

struct State {
    mode: AgentMode,
    core: Option<Core>,
    /// Приложение завершается: файл больше не создаётся.
    closed: bool,
}

/// Состояние агентского доступа и файл `agent-endpoint.json`.
pub struct AgentAccess {
    dir: PathBuf,
    /// SID пользователя; без него (кроме Unix) файл не создаётся.
    sid: Option<String>,
    state: Mutex<State>,
}

impl AgentAccess {
    /// `dir` — каталог данных приложения, `sid` — SID пользователя процесса.
    pub fn new(dir: PathBuf, sid: Option<String>) -> Self {
        Self {
            dir,
            sid,
            state: Mutex::new(State {
                mode: AgentMode::Off,
                core: None,
                closed: false,
            }),
        }
    }

    /// Путь к файлу.
    pub fn path(&self) -> PathBuf {
        self.dir.join(FILE_NAME)
    }

    /// Удалить файл, оставшийся от аварийно закрытого приложения. Вызывается при
    /// запуске, до запуска ядра.
    pub fn remove_stale(&self) -> Result<(), String> {
        remove_file(&self.path())
    }

    /// Режим изменился (настройка ядра `agent.mode`): файл появляется, меняется
    /// или удаляется. Ядро применяет режим само.
    pub fn set_mode(&self, mode: AgentMode) -> Result<(), String> {
        let mut st = self.lock();
        st.mode = mode;
        self.apply(&st)
    }

    /// Ядро запущено: адрес из READY-строки и его агентский токен.
    pub fn core_up(&self, url: &str, token: &str) -> Result<(), String> {
        let mut st = self.lock();
        st.core = Some(Core {
            url: url.to_owned(),
            token: token.to_owned(),
        });
        self.apply(&st)
    }

    /// Ядро остановлено или умерло: токен больше ничего не открывает.
    pub fn core_down(&self) -> Result<(), String> {
        let mut st = self.lock();
        st.core = None;
        self.apply(&st)
    }

    /// Выход из приложения: файл удаляется и больше не создаётся.
    pub fn shutdown(&self) -> Result<(), String> {
        let mut st = self.lock();
        st.closed = true;
        st.core = None;
        self.apply(&st)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Привести файл в соответствие состоянию.
    fn apply(&self, st: &State) -> Result<(), String> {
        let path = self.path();
        match (&st.core, st.mode) {
            (Some(core), AgentMode::Read | AgentMode::Control) if !st.closed => {
                let json = endpoint_json(&core.url, &core.token, st.mode);
                self.write(json.as_bytes()).inspect_err(|_| {
                    // Не получилось записать — старый файл (с прежним режимом
                    // или токеном) оставлять нельзя.
                    let _ = remove_file(&path);
                })
            }
            _ => remove_file(&path),
        }
    }

    fn write(&self, bytes: &[u8]) -> Result<(), String> {
        #[cfg(windows)]
        let sid = self
            .sid
            .as_deref()
            .ok_or("SID пользователя не прочитан — доступ агентов не включён")?;
        #[cfg(not(windows))]
        let _ = &self.sid;
        retry(|| {
            crate::ui_state::write_atomic_with(&self.dir, FILE_NAME, bytes, |tmp| {
                #[cfg(windows)]
                {
                    crate::private_file::create_new_with_sddl(tmp, &sddl(sid))
                }
                #[cfg(not(windows))]
                {
                    create_private(tmp)
                }
            })
        })
    }
}

/// Unix: новый файл с правами 0600.
#[cfg(not(windows))]
fn create_private(path: &Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

/// Повторить операцию, если файл на мгновение занят читателем.
fn retry(mut op: impl FnMut() -> Result<(), String>) -> Result<(), String> {
    let mut last = Ok(());
    for attempt in 0..IO_ATTEMPTS {
        last = op();
        if last.is_ok() {
            return last;
        }
        if attempt + 1 < IO_ATTEMPTS {
            std::thread::sleep(IO_PAUSE);
        }
    }
    last
}

/// Удалить файл; его отсутствие — не ошибка.
fn remove_file(path: &Path) -> Result<(), String> {
    retry(|| match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    })
}

#[cfg(test)]
mod tests;
