// SPDX-License-Identifier: GPL-3.0-only

//! Параметры файловой системы, на которой лежит файл, из `/proc/self/mountinfo`:
//! `nosuid` (права файла не действуют) и только чтение (`setcap` не записать).
//! Чистый разбор текста — без системных вызовов.

/// Параметры точки монтирования.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MountFlags {
    pub nosuid: bool,
    pub read_only: bool,
}

/// Восьмеричные escape-последовательности `\040` в пути точки монтирования.
fn unescape(field: &str) -> String {
    let bytes = field.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let octal = bytes
            .get(i + 1..i + 4)
            .filter(|d| d.iter().all(|c| (b'0'..=b'7').contains(c)));
        let decoded = octal.and_then(|d| {
            let value = d.iter().fold(0u32, |acc, c| acc * 8 + u32::from(c - b'0'));
            u8::try_from(value).ok()
        });
        match (bytes[i], decoded) {
            (b'\\', Some(byte)) => {
                out.push(byte);
                i += 4;
            }
            (byte, _) => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn covers(mount: &str, path: &str) -> bool {
    mount == "/"
        || path == mount
        || path
            .strip_prefix(mount)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// Параметры точки монтирования, накрывающей `path` (самая вложенная; из
/// равных — последняя в списке, она перекрывает прежние). `None` — не нашлась.
#[must_use]
pub fn mount_flags(mountinfo: &str, path: &str) -> Option<MountFlags> {
    let mut best: Option<(usize, MountFlags)> = None;
    for line in mountinfo.lines() {
        let mut fields = line.split_whitespace();
        let (Some(mount), Some(options)) = (fields.nth(4), fields.next()) else {
            continue;
        };
        let mount = unescape(mount);
        if !covers(&mount, path) || best.is_some_and(|(len, _)| len > mount.len()) {
            continue;
        }
        let has = |name: &str| options.split(',').any(|o| o == name);
        let flags = MountFlags {
            nosuid: has("nosuid"),
            read_only: has("ro"),
        };
        best = Some((mount.len(), flags));
    }
    best.map(|(_, flags)| flags)
}
