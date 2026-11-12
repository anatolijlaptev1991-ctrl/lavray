// SPDX-License-Identifier: GPL-3.0-only

//! Тесты teardown-проверки сети (§6).

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
    let names: HashSet<&str> = StaleResource::ALL
        .iter()
        .map(super::StaleResource::as_str)
        .collect();
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
    // Unchecked не находка, но и не «чисто»: Stopped по такому отчёту нельзя.
    assert!(!report.is_clean());
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

fn all(outcome: ProbeOutcome) -> Vec<(StaleResource, ProbeOutcome)> {
    StaleResource::ALL
        .iter()
        .map(|&r| (r, outcome.clone()))
        .collect()
}

/// Чисто — только когда все пять обязательных проб дали `Clean`.
#[test]
fn clean_requires_every_mandatory_probe_to_be_clean() {
    assert!(TeardownReport::from_findings(all(ProbeOutcome::Clean)).is_clean());
    assert!(!TeardownReport::default().is_clean(), "пустой отчёт");
    let mut partial = all(ProbeOutcome::Clean);
    partial.pop();
    assert!(
        !TeardownReport::from_findings(partial).is_clean(),
        "частичный отчёт: нет пробы ext_processes"
    );
    let mut one_unchecked = all(ProbeOutcome::Clean);
    one_unchecked[2].1 = ProbeOutcome::Unchecked;
    assert!(!TeardownReport::from_findings(one_unchecked).is_clean());
    assert!(!TeardownReport::from_findings(all(ProbeOutcome::Stale("x".into()))).is_clean());
}
