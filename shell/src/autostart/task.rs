// SPDX-License-Identifier: GPL-3.0-only

//! Задача планировщика для автозапуска с правами администратора (T-82):
//! имя на пользователя, XML с дескриптором безопасности, временный файл,
//! проверка «exe установлен».

use crate::files::bounded::same_content;
use crate::launch::ARG_TRAY;
use std::fs::File;
use std::io::Write;
use std::path::{Component, Path, PathBuf, Prefix};

/// Общее начало имени задач `LAVRay`; установщик удаляет все `LAVRay-*`.
pub const TASK_PREFIX: &str = "LAVRay";

/// Ревизия XML задачи. Метка лежит в описании задачи (его планировщик хранит и
/// отдаёт как есть, в отличие от SDDL, который он может переписать в своей
/// записи): по ней повышенный экземпляр узнаёт задачи старого вида и пересоздаёт.
pub const TASK_REVISION: &str = "acl-v2";

/// Дескриптор безопасности задачи (SDDL): полный доступ у администраторов и
/// SYSTEM, у пользователя — только чтение (`FR`). Читать задачу
/// (`schtasks /Query`) обычный процесс сможет, а менять и удалять её, то есть
/// подменить действие задачи с наивысшими правами, — нет. Планировщик по
/// документации сам добавляет разрешающую запись субъекту задачи (флаг
/// `TASK_DONT_ADD_PRINCIPAL_ACE` через `schtasks /XML` не передать); записи на
/// изменение это не даёт.
#[must_use]
pub fn task_sddl(sid: &str) -> String {
    format!("D:(A;;FA;;;BA)(A;;FA;;;SY)(A;;FR;;;{sid})")
}

/// Имя задачи пользователя: `LAVRay-<SID>`. Задачи разных учётных записей на
/// одном ПК не пересекаются, а `UserId` в XML — тот же SID.
pub fn task_name(sid: &str) -> String {
    format!("{TASK_PREFIX}-{sid}")
}

/// Текст в узел XML: только символы, которые разбор считает разметкой.
fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// XML задачи планировщика. `schtasks` по умолчанию не запускает задачу от
/// батареи и снимает её при переходе на батарею, поэтому настройки заданы
/// явно (ноутбук). `IgnoreNew` не даёт второй копии задачи стартовать поверх
/// первой. Пользователь задан SID из токена процесса.
pub fn task_xml(exe: &Path, sid: &str) -> String {
    let user = xml_escape(sid);
    let sddl = xml_escape(&task_sddl(sid));
    let command = xml_escape(&format!("\"{}\"", exe.display()));
    let workdir = exe.parent().map_or(String::new(), |dir| {
        format!(
            "\n      <WorkingDirectory>{}</WorkingDirectory>",
            xml_escape(&dir.display().to_string())
        )
    });
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <SecurityDescriptor>{sddl}</SecurityDescriptor>
    <Description>LAVRay: start after user logon ({TASK_REVISION})</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>{user}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{command}</Command>
      <Arguments>{ARG_TRAY}</Arguments>{workdir}
    </Exec>
  </Actions>
</Task>
"#
    )
}

/// XML в виде, который понимает `schtasks /XML`: UTF-16 LE с BOM (кодировка
/// объявлена в заголовке; пути с кириллицей не теряются).
pub fn encode_task_file(xml: &str) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(2 + xml.len() * 2); // UTF-16 ≤ 2 байт на байт UTF-8
    bytes.extend_from_slice(&[0xFF, 0xFE]);
    for unit in xml.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    bytes
}

/// Временный файл с XML задачи. Создаётся эксклюзивно (`create_new`, случайное
/// имя), затем открывается на чтение с запретом записи и удаления для других
/// (Windows: `FILE_SHARE_READ`), содержимое сверяется с записанным, и файл
/// удерживается открытым до удаления. Иначе процесс того же пользователя мог
/// бы подменить XML между записью и чтением `schtasks`, а задача с
/// `HighestAvailable` исполнялась бы с правами администратора.
pub struct TaskFile {
    path: PathBuf,
    handle: Option<File>,
}

impl TaskFile {
    pub fn create(bytes: &[u8]) -> Result<Self, String> {
        let mut random = [0u8; 8];
        getrandom::fill(&mut random).map_err(|e| format!("случайное имя файла: {e}"))?;
        let hex: String = random.iter().fold(String::with_capacity(16), |mut s, b| {
            use std::fmt::Write;
            let _ = write!(s, "{b:02x}");
            s
        });
        let name = format!("lavray-task-{hex}.xml");
        let path = std::env::temp_dir().join(name);
        let mut writer = std::fs::OpenOptions::new();
        writer.write(true).create_new(true);
        let mut file = writer
            .open(&path)
            .map_err(|e| format!("временный файл задачи {}: {e}", path.display()))?;
        // С этого места файл существует: при любой ошибке Drop его уберёт.
        let mut task_file = Self { path, handle: None };
        file.write_all(bytes)
            .and_then(|()| file.flush())
            .map_err(|e| format!("запись {}: {e}", task_file.path.display()))?;
        drop(file);

        let mut reader = std::fs::OpenOptions::new();
        reader.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            reader.share_mode(1); // FILE_SHARE_READ: писать и удалять никто не может
        }
        let mut locked = reader
            .open(&task_file.path)
            .map_err(|e| format!("блокировка {}: {e}", task_file.path.display()))?;
        let same = same_content(&mut locked, bytes)
            .map_err(|e| format!("чтение {}: {e}", task_file.path.display()))?;
        if !same {
            return Err(format!(
                "файл {} изменён сторонним процессом",
                task_file.path.display()
            ));
        }
        task_file.handle = Some(locked);
        Ok(task_file)
    }

    pub fn path_arg(&self) -> String {
        self.path.display().to_string()
    }
}

impl Drop for TaskFile {
    fn drop(&mut self) {
        drop(self.handle.take()); // сначала закрыть, потом удалять
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Присутствует ли задача `name` в выводе `schtasks /Query /FO CSV /NH`: первое
/// поле строки — `"\<имя>"` (задачи корневой папки). Регистр не учитывается.
pub fn listed_in_csv(stdout: &str, name: &str) -> bool {
    let wanted = format!("\\{name}");
    stdout.lines().any(|line| {
        line.trim()
            .strip_prefix('"')
            .and_then(|rest| rest.split('"').next())
            .is_some_and(|field| field.eq_ignore_ascii_case(&wanted))
    })
}

/// Компоненты пути в нижнем регистре, `\\?\C:` и `C:` — одно и то же. `None` —
/// в пути есть `..`: такой путь не канонизирован и сравнению не доверяем.
fn lowered_components(path: &Path) -> Option<Vec<String>> {
    let mut out = Vec::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => out.push(match prefix.kind() {
                Prefix::Disk(d) | Prefix::VerbatimDisk(d) => {
                    format!("{}:", char::from(d).to_ascii_lowercase())
                }
                _ => prefix.as_os_str().to_string_lossy().to_lowercase(),
            }),
            Component::RootDir => out.push("\\".to_string()),
            Component::Normal(part) => out.push(part.to_string_lossy().to_lowercase()),
            Component::CurDir => {}
            Component::ParentDir => return None,
        }
    }
    Some(out)
}

/// Лежит ли `exe` строго внутри одного из каталогов `roots` (без учёта регистра).
/// Пути должны быть канонизированы вызывающим: ссылка из Program Files на
/// каталог пользователя иначе обошла бы проверку.
pub fn is_under_any(exe: &Path, roots: &[PathBuf]) -> bool {
    let Some(exe) = lowered_components(exe) else {
        return false;
    };
    roots.iter().any(|root| {
        lowered_components(root).is_some_and(|root| {
            !root.is_empty() && exe.len() > root.len() && exe[..root.len()] == root[..]
        })
    })
}

/// Системные каталоги Program Files (обычный, x86, x64) по `SHGetKnownFolderPath`:
/// переменные окружения подменить проще, поэтому им не доверяем.
#[cfg(windows)]
pub fn program_files_dirs() -> Vec<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::Com::CoTaskMemFree;
    use windows_sys::Win32::UI::Shell::{
        FOLDERID_ProgramFiles, FOLDERID_ProgramFilesX64, FOLDERID_ProgramFilesX86,
        SHGetKnownFolderPath,
    };

    let mut dirs: Vec<PathBuf> = Vec::new();
    for id in [
        &FOLDERID_ProgramFiles,
        &FOLDERID_ProgramFilesX64,
        &FOLDERID_ProgramFilesX86,
    ] {
        let mut text: *mut u16 = std::ptr::null_mut();
        // SAFETY: `id` — валидная GUID, `text` получает строку, выделенную
        // системой; нулевой токен — текущий пользователь.
        let hr = unsafe { SHGetKnownFolderPath(id, 0, std::ptr::null_mut(), &raw mut text) };
        if hr >= 0 && !text.is_null() {
            // SAFETY: строка нуль-терминирована, длина считается до нуля.
            let units = unsafe {
                let mut len = 0;
                while *text.add(len) != 0 {
                    len += 1;
                }
                std::slice::from_raw_parts(text, len)
            };
            let path = PathBuf::from(std::ffi::OsString::from_wide(units));
            let path = std::fs::canonicalize(&path).unwrap_or(path);
            if !dirs.contains(&path) {
                dirs.push(path);
            }
        }
        // SAFETY: память выделена `SHGetKnownFolderPath` и освобождается так
        // (в том числе при ошибке, когда указатель может быть не нулевым).
        unsafe { CoTaskMemFree(text.cast()) };
    }
    dirs
}

#[cfg(not(windows))]
pub fn program_files_dirs() -> Vec<PathBuf> {
    Vec::new()
}
