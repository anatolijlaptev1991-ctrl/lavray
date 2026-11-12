// SPDX-License-Identifier: GPL-3.0-only

//! Создание файла с явным дескриптором безопасности (Windows).
//!
//! Нужен там, где права по умолчанию (унаследованные от `%APPDATA%`) шире, чем
//! нужно файлу: `ui-state.json` от повышенного процесса (доступ пользователю) и
//! `agent-endpoint.json` с токеном агентов (только пользователь и SYSTEM).

#[cfg(windows)]
pub use imp::create_new_with_sddl;

#[cfg(windows)]
mod imp {
    use std::fs::File;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::FromRawHandle;
    use std::path::Path;
    use windows_sys::Win32::Foundation::{LocalFree, GENERIC_WRITE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
    use windows_sys::Win32::Storage::FileSystem::{CreateFileW, CREATE_NEW, FILE_ATTRIBUTE_NORMAL};

    /// Создать новый файл (`CREATE_NEW`) с дескриптором безопасности из строки
    /// SDDL. Файла быть не должно: существующий не перезаписывается.
    pub fn create_new_with_sddl(path: &Path, sddl: &str) -> std::io::Result<File> {
        let descriptor: Vec<u16> = sddl.encode_utf16().chain(std::iter::once(0)).collect();
        let mut security: *mut core::ffi::c_void = std::ptr::null_mut();
        // SAFETY: строка нуль-терминирована, `security` получает дескриптор,
        // выделенный системой (освобождается `LocalFree` ниже).
        let converted = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                descriptor.as_ptr(),
                SDDL_REVISION_1,
                &raw mut security,
                std::ptr::null_mut(),
            )
        };
        if converted == 0 {
            return Err(std::io::Error::last_os_error());
        }
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: security,
            bInheritHandle: 0,
        };
        let wide: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        // SAFETY: путь нуль-терминирован, атрибуты и дескриптор живут до
        // конца вызова; без общего доступа, пока идёт запись.
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                GENERIC_WRITE,
                0,
                &raw const attributes,
                CREATE_NEW,
                FILE_ATTRIBUTE_NORMAL,
                std::ptr::null_mut(),
            )
        };
        let error = std::io::Error::last_os_error();
        // SAFETY: дескриптор выделен системой и больше не нужен.
        unsafe { LocalFree(security) };
        if handle == INVALID_HANDLE_VALUE {
            return Err(error);
        }
        // SAFETY: хэндл только что открыт и принадлежит `File`.
        Ok(unsafe { File::from_raw_handle(handle) })
    }
}
