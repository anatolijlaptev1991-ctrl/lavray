// SPDX-License-Identifier: GPL-3.0-only

//! Teardown-проверка сети «зависший TUN» (§6).
//!
//! Закрытое соединение ≠ мёртвый процесс ≠ освобождённый TUN (AUDIT §7.1.2,
//! LNB-21): после любого исхода, когда процесс ядра мёртв, и **на каждом
//! старте** (страж восстановления FR-UI-270) оболочка прогоняет пять
//! детекторов таблицы §6 (адаптер TUN, маршруты, системный прокси,
//! DNS-состояние, процессы `ext:*`) в пределах бюджета
//! [`T_TEARDOWN_VERIFY`](super::T_TEARDOWN_VERIFY) (3 с).
//!
//! Чистятся только СВОИ ресурсы: имя адаптера [`TUN_ADAPTER_NAME`], тег
//! маршрутов через адаптер, значение прокси = наш inbound, сохранённый
//! снимок DNS-эталона (FR-UI-259); адаптер/маршруты — через
//! привилегированного помощника §7. Никаких «убить все процессы с именем
//! ядра» — только сохранённые PID (LNB-09).
//!
//! Скаффолд: здесь — полный перечень детекторов и типы отчёта; реализации
//! платформенных проб (запросы ОС + парсинг, мок-вывод в тестах) —
//! **реализация в следующей итерации**.

/// Имя нашего TUN-адаптера (§6: `Get-NetAdapter -Name lavray-tun` (Wintun),
/// `ip link show lavray-tun`, utun-адаптеры с нашей меткой на macOS).
pub const TUN_ADAPTER_NAME: &str = "lavray-tun";

/// Детектор «зависшего» ресурса — ровно пять строк таблицы §6.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum StaleResource {
    /// Адаптер TUN: Windows `Get-NetAdapter -Name lavray-tun` (Wintun);
    /// Linux `ip link show lavray-tun`; macOS — utun-адаптеры с нашей меткой.
    TunAdapter,
    /// Маршруты через адаптер: Windows `route print` (фильтр через адаптер);
    /// Linux `ip route show dev lavray-tun`; macOS `netstat -rn`.
    Routes,
    /// Системный прокси: Windows WinINET == наш inbound? (иначе — снимок не
    /// восстановлен); Linux gsettings mode; macOS networksetup (§9, FR-UI-259).
    SystemProxy,
    /// DNS-состояние (Р2-25): Windows `Get-DnsClientServerAddress` на эталон;
    /// Linux `resolv.conf`/systemd-resolved == снимок эталона (FR-UI-259);
    /// macOS `networksetup -getdnsservers` == снимок.
    DnsState,
    /// Процессы `ext:*` (Р2-24): Windows Job закрыт → мертвы, иначе tasklist
    /// по PID; Linux pgid мёртв, ps по PID; macOS ps по PID — никогда по
    /// имени образа (LNB-09).
    ExtProcesses,
}

impl StaleResource {
    /// Полный перечень детекторов §6 в порядке строк таблицы.
    pub const ALL: [StaleResource; 5] = [
        StaleResource::TunAdapter,
        StaleResource::Routes,
        StaleResource::SystemProxy,
        StaleResource::DnsState,
        StaleResource::ExtProcesses,
    ];

    /// Каноническое имя детектора (журнал чистки, «Troubleshooting» §6).
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::TunAdapter => "tun_adapter",
            Self::Routes => "routes",
            Self::SystemProxy => "system_proxy",
            Self::DnsState => "dns_state",
            Self::ExtProcesses => "ext_processes",
        }
    }
}

/// Результат одной пробы детектора.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProbeOutcome {
    /// Своих хвостов нет.
    Clean,
    /// Найден свой хвост — нужна чистка (описание хвоста для журнала;
    /// remediation — адаптер/маршруты через помощника §7, прокси/DNS —
    /// восстановление снимка FR-UI-259, процессы — по PID).
    Stale(String),
    /// Проба не выполнена: заглушка скаффолда либо проба недоступна —
    /// трактуется как «не подтверждена чистота», но не как найденный хвост.
    Unchecked,
}

/// Отчёт teardown-проверки: по одной записи на каждый детектор §6.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct TeardownReport {
    findings: Vec<(StaleResource, ProbeOutcome)>,
}

impl TeardownReport {
    /// Записи отчёта (детектор + исход пробы), в порядке §6.
    pub fn findings(&self) -> &[(StaleResource, ProbeOutcome)] {
        &self.findings
    }

    /// Найденные свои хвосты (только `Stale`).
    pub fn stale(&self) -> impl Iterator<Item = (StaleResource, &str)> {
        self.findings
            .iter()
            .filter_map(|(resource, outcome)| match outcome {
                ProbeOutcome::Stale(detail) => Some((*resource, detail.as_str())),
                _ => None,
            })
    }

    /// Отчёт из готовых исходов проб (мок-вывод тестов, будущие пробы).
    pub fn from_findings(findings: Vec<(StaleResource, ProbeOutcome)>) -> Self {
        Self { findings }
    }

    /// Что мешает объявить сеть чистой (для предупреждения): детектор и
    /// причина — `stale: …`, `unchecked`, `нет пробы`.
    pub fn unconfirmed_summary(&self) -> String {
        let parts: Vec<String> = StaleResource::ALL
            .iter()
            .filter_map(|&resource| {
                let outcome = self.findings.iter().find(|(r, _)| *r == resource);
                let why = match outcome.map(|(_, o)| o) {
                    Some(ProbeOutcome::Clean) => return None,
                    Some(ProbeOutcome::Stale(detail)) => format!("stale: {detail}"),
                    Some(ProbeOutcome::Unchecked) => "unchecked".to_owned(),
                    None => "нет пробы".to_owned(),
                };
                Some(format!("{}: {why}", resource.as_str()))
            })
            .collect();
        format!("чистота сети не подтверждена ({})", parts.join(", "))
    }

    /// Сеть подтверждена чистой: КАЖДЫЙ из пяти обязательных детекторов §6
    /// дал `Clean`. `Unchecked`, `Stale` и частичный/пустой отчёт чистотой
    /// не считаются — только по такому отчёту FSM вправе сказать `Stopped`.
    pub fn is_clean(&self) -> bool {
        StaleResource::ALL.iter().all(|resource| {
            self.findings
                .iter()
                .any(|(r, outcome)| r == resource && *outcome == ProbeOutcome::Clean)
        }) && self.stale().next().is_none()
    }
}

/// Прогнать один детектор §6.
///
/// ЗАГЛУШКА: всегда `Unchecked` — реализация платформенных проб (команды из
/// doc-комментариев [`StaleResource`], парсинг вывода, мок-вывод в тестах) —
/// в следующей итерации.
pub fn probe(_resource: StaleResource) -> ProbeOutcome {
    ProbeOutcome::Unchecked
}

/// Полный прогон всех детекторов §6 (старт/после смерти процесса ядра).
///
/// ЗАГЛУШКА: собирает [`probe`] по всем детекторам; бюджет
/// [`T_TEARDOWN_VERIFY`](super::T_TEARDOWN_VERIFY) 3 с будет держать
/// рантайм-драйвер. Реализация проб — в следующей итерации.
pub fn verify_all() -> TeardownReport {
    TeardownReport {
        findings: StaleResource::ALL
            .iter()
            .map(|&resource| (resource, probe(resource)))
            .collect(),
    }
}

#[cfg(test)]
mod tests;
