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

    /// Нет найденных хвостов (`Unchecked` чистотой не считается — см.
    /// [`ProbeOutcome::Unchecked`]; полный ответ даёт только отсутствие
    /// `Stale` при реализованных пробах).
    pub fn is_clean(&self) -> bool {
        self.findings
            .iter()
            .all(|(_, outcome)| !matches!(outcome, ProbeOutcome::Stale(_)))
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
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// Перечень детекторов — точно таблица §6: пять строк, без пропусков
    /// и дублей, в порядке таблицы.
    #[test]
    fn detector_list_covers_spec_section6_table() {
        assert_eq!(
            StaleResource::ALL.len(),
            5,
            "ровно пять проверок таблицы §6"
        );

        // Уникальность и канонические имена.
        let names: HashSet<&str> = StaleResource::ALL.iter().map(|r| r.as_str()).collect();
        assert_eq!(names.len(), 5, "канонические имена уникальны");

        let expected = [
            StaleResource::TunAdapter,
            StaleResource::Routes,
            StaleResource::SystemProxy,
            StaleResource::DnsState,
            StaleResource::ExtProcesses,
        ];
        for (want, got) in expected.iter().zip(StaleResource::ALL) {
            assert_eq!(want, &got, "порядок детекторов = порядок таблицы §6");
        }

        // Имя адаптера из §6 (свои ресурсы ищем строго по нему).
        assert_eq!(TUN_ADAPTER_NAME, "lavray-tun");
    }

    /// Заглушки честно сообщают `Unchecked` (не «чисто» и не «хвост»), и
    /// полный прогон строит отчёт на все пять детекторов.
    #[test]
    fn stub_probes_report_unchecked_for_all_detectors() {
        for resource in StaleResource::ALL {
            assert_eq!(probe(resource), ProbeOutcome::Unchecked, "{resource:?}");
        }
        let report = verify_all();
        assert_eq!(report.findings().len(), 5);
        assert!(
            report.stale().next().is_none(),
            "заглушка не придумывает хвосты"
        );
        // Unchecked не считается находкой, но и не должен считаться Clean
        // после реализации — здесь фиксируем только отсутствие Stale.
        assert!(report.is_clean());
    }

    /// Отчёт умеет отличать найденные хвосты (мок наполнения).
    #[test]
    fn report_exposes_stale_findings() {
        let report = TeardownReport {
            findings: vec![
                (StaleResource::TunAdapter, ProbeOutcome::Clean),
                (
                    StaleResource::Routes,
                    ProbeOutcome::Stale("10.0.0.0/24 dev lavray-tun".to_owned()),
                ),
            ],
        };
        assert!(!report.is_clean());
        let stale: Vec<(StaleResource, &str)> = report.stale().collect();
        assert_eq!(stale.len(), 1);
        assert_eq!(stale[0].0, StaleResource::Routes);
        assert!(stale[0].1.contains("lavray-tun"));
    }
}
