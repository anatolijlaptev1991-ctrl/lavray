//! Повышенные права процесса (T-46): TUN без прав администратора (Windows) или
//! root (Unix) не поднимется. Приложение само права не повышает
//! (shell-lifecycle §7, LNB-26): оболочка только отвечает, запущена ли она с
//! повышением, а UI объясняет, что делать. Служба TUN — отдельный эпик (T-81).

/// `true`, если процесс запущен с повышенными правами: Windows — токен с
/// `TokenIsElevated`, Unix — euid 0.
pub fn is_elevated() -> bool {
    imp::is_elevated()
}

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    pub fn is_elevated() -> bool {
        let mut token: HANDLE = std::ptr::null_mut();
        // SAFETY: псевдо-хэндл процесса закрывать не нужно; `token` — валидный
        // указатель на локальную переменную.
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut returned = 0u32;
        // SAFETY: `token` открыт выше; буфер — `repr(C)` структура, её размер
        // передан как длина.
        let ok = unsafe {
            GetTokenInformation(
                token,
                TokenElevation,
                std::ptr::from_mut(&mut elevation).cast(),
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut returned,
            )
        };
        // SAFETY: `token` открыт выше и закрывается ровно один раз.
        unsafe { CloseHandle(token) };
        ok != 0 && elevation.TokenIsElevated != 0
    }
}

#[cfg(unix)]
mod imp {
    pub fn is_elevated() -> bool {
        // SAFETY: `geteuid` — сисколл без аргументов и побочных эффектов.
        unsafe { libc::geteuid() == 0 }
    }
}

#[cfg(not(any(windows, unix)))]
mod imp {
    pub fn is_elevated() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::is_elevated;
    use std::process::Command;

    /// Ответ совпадает с независимой проверкой системы: Windows — членство
    /// токена в «Администраторах» (у неповышенного токена UAC группа «только
    /// для запрета», `IsInRole` даёт `False`); Unix — `id -u`.
    #[test]
    fn agrees_with_the_system_answer() {
        #[cfg(windows)]
        let expected = {
            let check = "([Security.Principal.WindowsPrincipal][Security.Principal.\
                WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.\
                WindowsBuiltInRole]::Administrator)";
            let out = Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", check])
                .output()
                .expect("powershell.exe запускается");
            String::from_utf8_lossy(&out.stdout).trim() == "True"
        };
        #[cfg(unix)]
        let expected = {
            let out = Command::new("id")
                .arg("-u")
                .output()
                .expect("id запускается");
            String::from_utf8_lossy(&out.stdout).trim() == "0"
        };
        #[cfg(not(any(windows, unix)))]
        let expected = false;
        assert_eq!(is_elevated(), expected);
        assert_eq!(is_elevated(), is_elevated());
    }
}
