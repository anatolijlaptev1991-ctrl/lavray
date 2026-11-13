// SPDX-License-Identifier: GPL-3.0-only

//! Разбор прав (capabilities) Linux: расширенный атрибут файла
//! `security.capability` и строки `CapEff`/`CapAmb` из `/proc/<pid>/status`.
//! Чистые функции над байтами и текстом — на Windows проверяются так же.

/// Номер права `CAP_NET_ADMIN`: без него ядро не создаёт TUN-интерфейс.
pub const CAP_NET_ADMIN: u32 = 12;

const REVISION_MASK: u32 = 0xFF00_0000;
const REVISION_2: u32 = 0x0200_0000;
const REVISION_3: u32 = 0x0300_0000;
/// Бит `VFS_CAP_FLAGS_EFFECTIVE` в первом слове атрибута.
const FLAG_EFFECTIVE: u32 = 1;
/// Длина атрибута: слово `magic_etc` и два слова (permitted, inheritable);
/// у ревизии 3 ещё `rootid`.
const LEN_REVISION_2: usize = 20;
const LEN_REVISION_3: usize = 24;

/// Права файла из `security.capability`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileCaps {
    pub permitted: u64,
    pub inheritable: u64,
    /// Флаг effective: права включаются при запуске (`+ep`, а не только `+p`).
    pub effective: bool,
}

impl FileCaps {
    /// Файл при запуске получает `CAP_NET_ADMIN` сразу (permitted + effective).
    #[must_use]
    pub fn grants_net_admin(&self) -> bool {
        self.effective && has_bit(self.permitted, CAP_NET_ADMIN)
    }
}

fn word(raw: &[u8], index: usize) -> Option<u32> {
    let bytes = raw.get(index * 4..index * 4 + 4)?;
    Some(u32::from_le_bytes(bytes.try_into().ok()?))
}

/// Разобрать `security.capability` (`VFS_CAP_REVISION_2` и `_3`, little-endian).
/// Ревизия 3 с ненулевым `rootid` относится к пользовательскому пространству
/// имён, а не к системе — для неё `None`, как и для неизвестной ревизии.
#[must_use]
pub fn parse_file_caps(raw: &[u8]) -> Option<FileCaps> {
    let magic = word(raw, 0)?;
    let need = match magic & REVISION_MASK {
        REVISION_2 => LEN_REVISION_2,
        REVISION_3 => LEN_REVISION_3,
        _ => return None,
    };
    if raw.len() < need || (need == LEN_REVISION_3 && word(raw, 5)? != 0) {
        return None;
    }
    let permitted = u64::from(word(raw, 1)?) | (u64::from(word(raw, 3)?) << 32);
    let inheritable = u64::from(word(raw, 2)?) | (u64::from(word(raw, 4)?) << 32);
    Some(FileCaps {
        permitted,
        inheritable,
        effective: magic & FLAG_EFFECTIVE != 0,
    })
}

/// Установлен ли бит `bit` в маске прав.
#[must_use]
pub fn has_bit(mask: u64, bit: u32) -> bool {
    bit < 64 && mask & (1 << bit) != 0
}

/// Значение поля прав (`CapEff`, `CapAmb`…) из текста `/proc/<pid>/status`.
#[must_use]
pub fn status_caps(status: &str, field: &str) -> Option<u64> {
    status.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name != field {
            return None;
        }
        u64::from_str_radix(value.trim(), 16).ok()
    })
}
