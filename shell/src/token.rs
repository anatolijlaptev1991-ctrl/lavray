// SPDX-License-Identifier: GPL-3.0-only

//! Токен процесса (T-81/T-82, ревью): SID пользователя и тип повышения.
//!
//! SID нужен задаче планировщика: имя `LAVRay-<SID>` и `UserId` в XML берутся
//! из токена, а не из переменных окружения `USERDOMAIN`/`USERNAME` (они
//! наследуются от родителя и неверны для AzureAD-учётных записей). Тип
//! повышения говорит, может ли обычный процесс повыситься сам: у администратора
//! с включённым UAC токен «урезанный» и UAC просто спросит согласие; у
//! обычного пользователя повышение требует пароля другой учётной записи.

/// Тип токена по `TokenElevationType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElevationKind {
    /// Токен без пары: обычный пользователь (или UAC выключен).
    Default,
    /// Повышенный токен администратора.
    Full,
    /// Урезанный токен администратора: есть связанный повышенный.
    Limited,
}

/// Может ли процесс повысить себя без чужой учётной записи. `kind` — тип токена
/// (`None` — прочитать не удалось: не блокируем, решит система), `elevated` —
/// процесс уже повышен.
#[must_use]
pub fn can_self_elevate(kind: Option<ElevationKind>, elevated: bool) -> bool {
    if elevated {
        return true;
    }
    !matches!(kind, Some(ElevationKind::Default))
}

/// Строка SID пользователя процесса (`S-1-5-21-…`); `None` — не Windows или
/// токен не прочитан.
#[must_use]
pub fn user_sid() -> Option<String> {
    imp::user_sid()
}

/// Тип повышения токена процесса; `None` — не Windows или токен не прочитан.
#[must_use]
pub fn elevation_kind() -> Option<ElevationKind> {
    imp::elevation_kind()
}

#[cfg(windows)]
mod imp {
    use super::ElevationKind;
    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, HANDLE};
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenElevationType, TokenElevationTypeDefault, TokenElevationTypeFull,
        TokenElevationTypeLimited, TokenUser, TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    /// Токен текущего процесса на чтение; закрывается при выходе из области.
    struct Token(HANDLE);

    impl Token {
        fn open() -> Option<Self> {
            let mut handle: HANDLE = std::ptr::null_mut();
            // SAFETY: псевдо-хэндл процесса закрывать не нужно; `handle` —
            // валидный указатель на локальную переменную.
            let ok = unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw mut handle) };
            (ok != 0).then_some(Self(handle))
        }
    }

    impl Drop for Token {
        fn drop(&mut self) {
            // SAFETY: хэндл открыт в `open` и закрывается ровно один раз.
            unsafe { CloseHandle(self.0) };
        }
    }

    pub fn user_sid() -> Option<String> {
        let token = Token::open()?;
        let mut needed = 0u32;
        // SAFETY: нулевой буфер нулевой длины — штатный запрос размера.
        unsafe {
            GetTokenInformation(token.0, TokenUser, std::ptr::null_mut(), 0, &raw mut needed)
        };
        if needed == 0 {
            return None;
        }
        // u64 вместо u8: структура TOKEN_USER требует выравнивания указателя.
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
        // SAFETY: буфер не меньше `needed` байт и выровнен.
        let ok = unsafe {
            GetTokenInformation(
                token.0,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                needed,
                &raw mut needed,
            )
        };
        if ok == 0 {
            return None;
        }
        // SAFETY: при успехе буфер начинается с корректной TOKEN_USER.
        let sid = unsafe { (*buffer.as_ptr().cast::<TOKEN_USER>()).User.Sid };
        let mut text: *mut u16 = std::ptr::null_mut();
        // SAFETY: `sid` указывает внутрь `buffer`, который жив; `text`
        // получает буфер, выделенный системой.
        if unsafe { ConvertSidToStringSidW(sid, &raw mut text) } == 0 || text.is_null() {
            return None;
        }
        // SAFETY: строка нуль-терминирована, длина считается до нуля.
        let units = unsafe {
            let mut len = 0;
            while *text.add(len) != 0 {
                len += 1;
            }
            std::slice::from_raw_parts(text, len)
        };
        let sid_text = String::from_utf16(units).ok();
        // SAFETY: буфер выделен `ConvertSidToStringSidW` и освобождается так.
        unsafe { LocalFree(text.cast()) };
        sid_text
    }

    pub fn elevation_kind() -> Option<ElevationKind> {
        let token = Token::open()?;
        let mut kind = 0i32;
        let mut returned = 0u32;
        // SAFETY: в `kind` помещается `TOKEN_ELEVATION_TYPE` (i32).
        let ok = unsafe {
            GetTokenInformation(
                token.0,
                TokenElevationType,
                std::ptr::from_mut(&mut kind).cast(),
                std::mem::size_of::<i32>() as u32,
                &raw mut returned,
            )
        };
        if ok == 0 {
            return None;
        }
        // константы windows-sys в snake/CamelCase: в образце match их не записать
        if kind == TokenElevationTypeDefault {
            Some(ElevationKind::Default)
        } else if kind == TokenElevationTypeFull {
            Some(ElevationKind::Full)
        } else if kind == TokenElevationTypeLimited {
            Some(ElevationKind::Limited)
        } else {
            None
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::ElevationKind;

    pub fn user_sid() -> Option<String> {
        None
    }

    pub fn elevation_kind() -> Option<ElevationKind> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_standard_user_cannot_elevate_itself() {
        // обычный пользователь: токен Default и не повышен — нужна чужая учётка
        assert!(!can_self_elevate(Some(ElevationKind::Default), false));
        // администратор с UAC: урезанный токен, система спросит согласие
        assert!(can_self_elevate(Some(ElevationKind::Limited), false));
        // уже повышен (в том числе при выключенном UAC) — повышать нечего
        assert!(can_self_elevate(Some(ElevationKind::Full), true));
        assert!(can_self_elevate(Some(ElevationKind::Default), true));
        // токен не прочитан: не блокируем, решит система
        assert!(can_self_elevate(None, false));
    }

    #[cfg(windows)]
    #[test]
    fn sid_comes_from_the_token_and_matches_whoami() {
        let sid = user_sid().expect("SID токена процесса");
        assert!(
            sid.starts_with("S-1-5-21-") || sid.starts_with("S-1-5-"),
            "{sid}"
        );
        assert!(
            sid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
            "{sid}"
        );
        // независимая проверка системой (только чтение)
        let out = std::process::Command::new("whoami")
            .args(["/user", "/fo", "csv", "/nh"])
            .output()
            .expect("whoami запускается");
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(
            text.contains(&sid),
            "SID {sid} не найден в выводе whoami: {text}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn elevation_kind_agrees_with_is_elevated() {
        let kind = elevation_kind().expect("тип повышения токена");
        let elevated = crate::elevation::is_elevated();
        // Full бывает только у повышенного токена; повышенный без UAC — Default.
        assert_eq!(
            kind == ElevationKind::Full,
            elevated && kind != ElevationKind::Default
        );
        if kind == ElevationKind::Full {
            assert!(elevated);
        }
        if !elevated {
            assert_ne!(kind, ElevationKind::Full);
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn other_systems_have_no_token_data() {
        assert_eq!(user_sid(), None);
        assert_eq!(elevation_kind(), None);
    }
}
