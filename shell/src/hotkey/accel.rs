// SPDX-License-Identifier: GPL-3.0-only

//! Разбор глобального сочетания клавиш (T-82).
//!
//! Глобальное сочетание перехватывается во всех программах, поэтому правила
//! строже, чем внутри окна:
//! - клавиша — буква A–Z, цифра 0–9 или F1–F24;
//! - буква или цифра — не меньше двух модификаторов, среди них Ctrl или Alt
//!   (Ctrl+C или Shift+K сломали бы копирование и набор текста везде);
//! - F-клавиша — хотя бы один модификатор;
//! - Win (Super) и системные сочетания (Alt+F4, Ctrl+Alt+F1…F12) не принимаются.
//!
//! Нормальная запись — `Ctrl+Alt+Shift+K`: модификаторы в этом порядке.

use std::fmt;

/// Модификаторы сочетания.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Mods {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

/// Клавиша сочетания.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Key {
    Letter(char),
    Digit(char),
    F(u8),
}

/// Проверенное сочетание.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Accel {
    pub mods: Mods,
    pub key: Key,
}

/// Почему сочетание не принято; строка — код ошибки для UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccelError {
    /// Не разобрать: неизвестная часть, нет клавиши, две клавиши, повтор.
    Invalid,
    /// Модификаторов мало для глобального сочетания.
    NoModifier,
    /// Win или системное сочетание.
    Reserved,
}

impl AccelError {
    #[must_use]
    pub fn code(self) -> &'static str {
        match self {
            Self::Invalid => "invalid_accel",
            Self::NoModifier => "no_modifier",
            Self::Reserved => "reserved",
        }
    }
}

/// Разобрать и проверить сочетание (регистр и пробелы не важны).
pub fn parse_accel(raw: &str) -> Result<Accel, AccelError> {
    let mut mods = Mods::default();
    let mut key = None;
    for part in raw.split('+').map(|p| p.trim().to_ascii_lowercase()) {
        let flag = match part.as_str() {
            "ctrl" | "control" => &mut mods.ctrl,
            "alt" | "option" => &mut mods.alt,
            "shift" => &mut mods.shift,
            "win" | "super" | "meta" | "cmd" | "command" => return Err(AccelError::Reserved),
            _ => {
                if key.replace(parse_key(&part)?).is_some() {
                    return Err(AccelError::Invalid);
                }
                continue;
            }
        };
        if std::mem::replace(flag, true) {
            return Err(AccelError::Invalid);
        }
    }
    let accel = Accel {
        mods,
        key: key.ok_or(AccelError::Invalid)?,
    };
    check(&accel)?;
    Ok(accel)
}

fn parse_key(part: &str) -> Result<Key, AccelError> {
    let mut chars = part.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) if c.is_ascii_alphabetic() => Ok(Key::Letter(c.to_ascii_uppercase())),
        (Some(c), None) if c.is_ascii_digit() => Ok(Key::Digit(c)),
        (Some('f'), Some(_)) => match part[1..].parse::<u8>() {
            Ok(n @ 1..=24) if !part[1..].starts_with('0') => Ok(Key::F(n)),
            _ => Err(AccelError::Invalid),
        },
        _ => Err(AccelError::Invalid),
    }
}

fn check(a: &Accel) -> Result<(), AccelError> {
    let Mods { ctrl, alt, shift } = a.mods;
    let count = [ctrl, alt, shift].iter().filter(|m| **m).count();
    match a.key {
        Key::F(4) if alt && !ctrl && !shift => Err(AccelError::Reserved),
        Key::F(n) if ctrl && alt && n <= 12 => Err(AccelError::Reserved),
        Key::F(_) if count == 0 => Err(AccelError::NoModifier),
        Key::Letter(_) | Key::Digit(_) if count < 2 || !(ctrl || alt) => {
            Err(AccelError::NoModifier)
        }
        _ => Ok(()),
    }
}

impl fmt::Display for Accel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (on, name) in [
            (self.mods.ctrl, "Ctrl+"),
            (self.mods.alt, "Alt+"),
            (self.mods.shift, "Shift+"),
        ] {
            if on {
                f.write_str(name)?;
            }
        }
        match self.key {
            Key::Letter(c) | Key::Digit(c) => write!(f, "{c}"),
            Key::F(n) => write!(f, "F{n}"),
        }
    }
}

#[cfg(test)]
#[path = "accel_tests.rs"]
mod tests;
