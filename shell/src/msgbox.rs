// SPDX-License-Identifier: GPL-3.0-only

//! Сообщения до появления окна (T-81, ревью): окна приложения ещё нет (или оно
//! не создалось), а релизная сборка без консоли, поэтому `eprintln!` никто не
//! увидит. Текст двуязычный (ru/en): словарей UI здесь ещё нет.

/// Заголовок всех сообщений.
pub const TITLE: &str = "LAVRay";

/// Уже запущен экземпляр от администратора, а этот — обычный: открыть чужой
/// мьютекс single-instance нельзя, запуск второго ядра на тех же данных вреден.
pub const ALREADY_RUNNING_ELEVATED: &str = "LAVRay уже запущен от имени администратора — откройте его из области уведомлений (трея).\n\nLAVRay is already running as administrator — open it from the notification area (system tray).";

/// Прежний экземпляр не вышел за отведённое время при перезапуске.
#[must_use]
pub fn previous_instance_alive(pid: u32, seconds: u64) -> String {
    format!(
        "Предыдущая копия LAVRay (процесс {pid}) не завершилась за {seconds} с. Закройте её (значок в трее → «Выход») и запустите LAVRay снова.\n\nThe previous LAVRay (process {pid}) did not exit within {seconds} s. Close it (tray icon → Exit) and start LAVRay again."
    )
}

/// Окно не создалось (например, `WebView2` не запустился).
#[must_use]
pub fn window_failed(reason: &str) -> String {
    format!(
        "Не удалось создать окно LAVRay: {reason}\n\nCould not create the LAVRay window: {reason}"
    )
}

/// Показать сообщение и вернуться после нажатия «OK». Linux: окно zenity или
/// kdialog (если есть) и stderr; macOS: stderr.
pub fn show(text: &str) {
    imp::show(TITLE, text);
}

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, MB_ICONERROR, MB_OK, MB_SETFOREGROUND,
    };

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn show(title: &str, text: &str) {
        let (title, text) = (wide(title), wide(text));
        // SAFETY: обе строки нуль-терминированы и живут до конца вызова;
        // владельца у окна сообщения нет (нулевой HWND).
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                text.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONERROR | MB_SETFOREGROUND,
            );
        }
    }
}

/// Программа, которой показывается окно сообщения на Linux.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialog {
    Zenity,
    Kdialog,
}

impl Dialog {
    /// Имя исполняемого файла.
    #[must_use]
    pub const fn program(self) -> &'static str {
        match self {
            Self::Zenity => "zenity",
            Self::Kdialog => "kdialog",
        }
    }

    /// Аргументы окна ошибки с заголовком и текстом (без разметки).
    #[must_use]
    pub fn args(self, title: &str, text: &str) -> Vec<String> {
        match self {
            Self::Zenity => vec![
                "--error".into(),
                "--no-markup".into(),
                format!("--title={title}"),
                format!("--text={text}"),
            ],
            // kdialog читает текст как разметку: `&`, `<`, `>` экранируются
            Self::Kdialog => vec![
                "--title".into(),
                title.into(),
                "--error".into(),
                text.replace('&', "&amp;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;"),
            ],
        }
    }
}

/// Каталоги поиска zenity и kdialog: фиксированные, не через `PATH`.
pub const DIALOG_DIRS: [&str; 3] = ["/usr/bin", "/bin", "/usr/local/bin"];

/// Какая программа и по какому пути доступна; `exists` проверяет файл. zenity
/// предпочтительнее (есть и в GNOME, и в других средах), затем kdialog.
pub fn pick_dialog(
    exists: impl Fn(&std::path::Path) -> bool,
) -> Option<(Dialog, std::path::PathBuf)> {
    [Dialog::Zenity, Dialog::Kdialog]
        .into_iter()
        .find_map(|dialog| {
            DIALOG_DIRS
                .iter()
                .map(|dir| std::path::Path::new(dir).join(dialog.program()))
                .find(|path| exists(path))
                .map(|path| (dialog, path))
        })
}

#[cfg(not(windows))]
mod imp {
    /// Окно сообщения: zenity или kdialog из фиксированных каталогов; ждёт
    /// нажатия «OK» не дольше двух минут.
    #[cfg(target_os = "linux")]
    fn dialog(title: &str, text: &str) {
        const TIMEOUT: std::time::Duration = std::time::Duration::from_mins(2);
        if let Some((dialog, path)) = super::pick_dialog(std::path::Path::is_file) {
            let mut cmd = std::process::Command::new(path);
            cmd.args(dialog.args(title, text));
            let _ = crate::exec::run_timeout(&mut cmd, TIMEOUT);
        }
    }

    #[cfg(not(target_os = "linux"))]
    fn dialog(_title: &str, _text: &str) {}

    /// stderr всегда (журнал при запуске из терминала); на Linux ещё и окно:
    /// релизный запуск из меню приложений консоли не имеет.
    pub fn show(title: &str, text: &str) {
        eprintln!("{title}: {text}");
        dialog(title, text);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_are_bilingual_and_carry_the_facts() {
        for text in [
            ALREADY_RUNNING_ELEVATED.to_string(),
            previous_instance_alive(4242, 20),
            window_failed("WebView2 не найден"),
        ] {
            assert!(text.contains("\n\n"), "русская и английская части: {text}");
        }
        assert!(ALREADY_RUNNING_ELEVATED.contains("от имени администратора"));
        assert!(ALREADY_RUNNING_ELEVATED.contains("already running as administrator"));
        let alive = previous_instance_alive(4242, 20);
        assert_eq!(alive.matches("4242").count(), 2);
        assert!(alive.contains("20 с") && alive.contains("20 s"));
        assert_eq!(window_failed("boom").matches("boom").count(), 2);
    }

    #[test]
    fn dialog_arguments_carry_title_and_text_verbatim() {
        let zenity = Dialog::Zenity.args(
            "LAVRay", "a <b>
c",
        );
        assert_eq!(zenity[0], "--error");
        assert!(zenity.contains(&"--no-markup".to_string()));
        assert!(zenity.contains(
            &"--text=a <b>
c"
            .to_string()
        ));
        assert_eq!(
            Dialog::Kdialog.args("T", "x"),
            ["--title", "T", "--error", "x"]
        );
    }

    #[test]
    fn dialog_is_looked_up_in_fixed_directories_zenity_first() {
        use std::path::Path;
        let both = |_: &Path| true;
        assert_eq!(
            pick_dialog(both),
            Some((Dialog::Zenity, Path::new("/usr/bin/zenity").to_path_buf()))
        );
        let kde_only = |p: &Path| p.ends_with("kdialog") && p.starts_with("/bin");
        assert_eq!(
            pick_dialog(kde_only),
            Some((Dialog::Kdialog, Path::new("/bin/kdialog").to_path_buf()))
        );
        assert_eq!(pick_dialog(|_| false), None);
    }
}
