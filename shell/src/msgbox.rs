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
pub fn previous_instance_alive(pid: u32, seconds: u64) -> String {
    format!(
        "Предыдущая копия LAVRay (процесс {pid}) не завершилась за {seconds} с. Закройте её (значок в трее → «Выход») и запустите LAVRay снова.\n\nThe previous LAVRay (process {pid}) did not exit within {seconds} s. Close it (tray icon → Exit) and start LAVRay again."
    )
}

/// Окно не создалось (например, WebView2 не запустился).
pub fn window_failed(reason: &str) -> String {
    format!(
        "Не удалось создать окно LAVRay: {reason}\n\nCould not create the LAVRay window: {reason}"
    )
}

/// Показать сообщение и вернуться после нажатия «OK». Не Windows: в stderr.
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

#[cfg(not(windows))]
mod imp {
    pub fn show(title: &str, text: &str) {
        eprintln!("{title}: {text}");
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
}
