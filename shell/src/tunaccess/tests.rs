// SPDX-License-Identifier: GPL-3.0-only

use super::caps::*;
use super::commands::{elevation_state, guarded, render};
use super::mounts::{mount_flags, MountFlags};
use super::*;
use std::cell::RefCell;

fn words(items: &[u32]) -> Vec<u8> {
    items.iter().flat_map(|w| w.to_le_bytes()).collect()
}

/// Права `setcap cap_net_admin+ep` ревизии 2.
fn rev2(flags: u32) -> Vec<u8> {
    words(&[0x0200_0000 | flags, (1 << 12) | (1 << 10), 0, 0, 0])
}

#[test]
fn parses_revision_2_with_effective_flag() {
    let caps = parse_file_caps(&rev2(1)).unwrap();
    assert!(caps.effective);
    assert_eq!(caps.permitted, (1 << 12) | (1 << 10));
    assert!(caps.grants_net_admin());
}

#[test]
fn without_effective_flag_net_admin_is_not_granted() {
    let caps = parse_file_caps(&rev2(0)).unwrap();
    assert!(!caps.effective);
    assert!(!caps.grants_net_admin());
}

#[test]
fn parses_revision_3_and_high_words() {
    let raw = words(&[0x0300_0001, 1 << 12, 7, 0x20, 9, 0]);
    let caps = parse_file_caps(&raw).unwrap();
    assert_eq!(caps.permitted, (0x20 << 32) | (1 << 12));
    assert_eq!(caps.inheritable, (9 << 32) | 7);
    assert!(caps.grants_net_admin());
}

#[test]
fn rejects_namespaced_unknown_and_short_attributes() {
    assert_eq!(
        parse_file_caps(&words(&[0x0300_0001, 1 << 12, 0, 0, 0, 1000])),
        None
    );
    assert_eq!(parse_file_caps(&words(&[0x0100_0001, 1 << 12, 0])), None);
    assert_eq!(parse_file_caps(&rev2(1)[..19]), None);
    assert_eq!(parse_file_caps(&[]), None);
}

#[test]
fn reads_hex_masks_from_proc_status() {
    let status = "Name:\tx\nCapInh:\t0000000000000000\nCapEff:\t0000000000001400\nCapAmb:\t0\n";
    assert_eq!(status_caps(status, "CapEff"), Some(0x1400));
    assert!(has_bit(0x1400, CAP_NET_ADMIN));
    assert_eq!(status_caps(status, "CapAmb"), Some(0));
    assert!(!has_bit(0, CAP_NET_ADMIN));
    assert_eq!(status_caps(status, "CapBnd"), None);
}

const MOUNTINFO: &str = "\
24 1 8:1 / / rw,relatime shared:1 - ext4 /dev/sda1 rw
30 24 0:27 / /usr/lib/LAVRay ro,nosuid,nodev - squashfs /dev/loop0 ro
31 24 0:28 / /mnt/with\\040space rw,nosuid - tmpfs tmpfs rw
";

#[test]
fn finds_the_innermost_mount() {
    let root = mount_flags(MOUNTINFO, "/usr/bin/x").unwrap();
    assert_eq!(root, MountFlags::default());
    let squash = mount_flags(MOUNTINFO, "/usr/lib/LAVRay/binaries/lavray-core").unwrap();
    assert!(squash.nosuid && squash.read_only);
    assert!(mount_flags(MOUNTINFO, "/usr/lib/LAVRay2/x").unwrap() == MountFlags::default());
    assert!(mount_flags(MOUNTINFO, "/mnt/with space/f").unwrap().nosuid);
    assert_eq!(mount_flags("", "/x"), None);
}

fn dir() -> FileMeta {
    FileMeta {
        is_file: false,
        is_dir: true,
        uid: 0,
        mode: 0o755,
    }
}

fn core_facts() -> CoreFacts {
    let file = FileMeta {
        is_file: true,
        is_dir: false,
        uid: 0,
        mode: 0o755,
    };
    CoreFacts {
        path: PathBuf::from("/usr/lib/LAVRay/binaries/lavray-core"),
        chain: vec![file, dir(), dir(), dir(), dir()],
        flags: MountFlags::default(),
        file_caps: false,
        running_lacks_caps: false,
    }
}

fn facts() -> Facts {
    Facts {
        core: Some(core_facts()),
        pkexec: Some("/usr/bin/pkexec".into()),
        setcap: Some("/usr/sbin/setcap".into()),
        ..Facts::default()
    }
}

#[test]
fn a_plain_install_is_grantable() {
    assert_eq!(decide(&facts()), Access::Grantable);
}

#[test]
fn root_ambient_or_file_caps_mean_ready() {
    let mut root = facts();
    root.euid_root = true;
    let mut ambient = facts();
    ambient.ambient_net_admin = true;
    let mut capped = facts();
    capped.core.as_mut().unwrap().file_caps = true;
    for f in [root, ambient, capped] {
        assert_eq!(decide(&f), Access::Ready);
    }
}

#[test]
fn file_caps_on_nosuid_do_not_count() {
    let mut f = facts();
    let core = f.core.as_mut().unwrap();
    core.file_caps = true;
    core.flags.nosuid = true;
    assert_eq!(decide(&f), Access::Unavailable("nosuid"));
}

#[test]
fn each_unavailable_reason_is_told_apart() {
    let mut app = facts();
    app.appimage = true;
    assert_eq!(decide(&app), Access::Unavailable("appimage"));
    let mut nosuid = facts();
    nosuid.core.as_mut().unwrap().flags.nosuid = true;
    assert_eq!(decide(&nosuid), Access::Unavailable("nosuid"));
    let mut ro = facts();
    ro.core.as_mut().unwrap().flags.read_only = true;
    assert_eq!(decide(&ro), Access::Unavailable("read_only"));
}

#[test]
fn only_net_admin_is_granted() {
    assert_eq!(GRANT_CAPS, "cap_net_admin+ep");
}

#[test]
fn parallel_grants_are_refused_and_the_flag_is_released() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let flag = AtomicBool::new(false);
    let inner = guarded(&flag, || guarded(&flag, || Ok(())));
    assert_eq!(inner, Err("busy".to_string()));
    assert!(!flag.load(Ordering::SeqCst), "флаг снят после выхода");
    assert_eq!(guarded(&flag, || Ok(1)), Ok(1));
}

#[test]
fn unsafe_files_need_a_manual_command() {
    let mut writable = facts();
    writable.core.as_mut().unwrap().chain[0].mode = 0o775;
    let mut user_dir = facts();
    user_dir.core.as_mut().unwrap().chain[2].uid = 1000;
    let mut not_file = facts();
    not_file.core.as_mut().unwrap().chain[0].is_file = false;
    let mut gap = facts();
    gap.core.as_mut().unwrap().chain.truncate(1);
    for f in [writable, user_dir, not_file, gap] {
        assert_eq!(decide(&f), Access::Manual("not_secure"));
    }
}

#[test]
fn missing_pieces_are_reported() {
    let mut none = facts();
    none.core = None;
    assert_eq!(decide(&none), Access::Manual("core_not_found"));
    let mut no_pkexec = facts();
    no_pkexec.pkexec = None;
    assert_eq!(decide(&no_pkexec), Access::Manual("no_pkexec"));
    let mut no_setcap = facts();
    no_setcap.setcap = None;
    assert_eq!(decide(&no_setcap), Access::Manual("no_setcap"));
}

#[test]
fn core_restart_is_needed_only_when_file_has_caps_and_process_lacks_them() {
    let mut f = facts();
    assert!(!needs_core_restart(&f));
    let core = f.core.as_mut().unwrap();
    core.file_caps = true;
    core.running_lacks_caps = true;
    assert!(needs_core_restart(&f));
    f.euid_root = true;
    assert!(!needs_core_restart(&f));
}

#[test]
fn manual_command_quotes_the_path() {
    assert_eq!(
        manual_command(Path::new("/usr/lib/LAVRay/binaries/lavray-core")),
        "sudo setcap cap_net_admin+ep '/usr/lib/LAVRay/binaries/lavray-core'"
    );
    assert!(manual_command(Path::new("/a'b")).ends_with("'/a'\\''b'"));
}

fn out(code: Option<i32>, stderr: &str) -> Output {
    Output {
        code,
        stdout: String::new(),
        stderr: stderr.into(),
    }
}

#[test]
fn pkexec_results_map_to_ui_codes() {
    assert_eq!(grant_result(&out(Some(0), "")), Ok(()));
    assert_eq!(grant_result(&out(Some(126), "x")), Err("cancelled".into()));
    assert_eq!(
        grant_result(&out(Some(1), " boom\n")),
        Err("failed: boom".into())
    );
    assert_eq!(
        grant_result(&out(Some(127), "")),
        Err("failed: pkexec: код 127".into())
    );
    assert!(grant_result(&out(None, ""))
        .unwrap_err()
        .starts_with("failed: "));
}

#[test]
fn grant_runs_absolute_pkexec_with_setcap_and_canonical_path() {
    let calls = RefCell::new(Vec::new());
    let result = grant_with(&facts(), |program, args| {
        calls
            .borrow_mut()
            .push((program.to_path_buf(), args.to_vec()));
        Ok(out(Some(0), ""))
    });
    assert_eq!(result, Ok(()));
    let calls = calls.borrow();
    assert_eq!(calls[0].0, PathBuf::from("/usr/bin/pkexec"));
    assert_eq!(
        calls[0].1,
        [
            "/usr/sbin/setcap",
            GRANT_CAPS,
            "/usr/lib/LAVRay/binaries/lavray-core"
        ]
        .map(OsString::from)
    );
}

#[test]
fn grant_refuses_outside_the_grantable_state() {
    let mut f = facts();
    f.appimage = true;
    let result = grant_with(&f, |_, _| panic!("не должен запускаться"));
    assert_eq!(result, Err("not_grantable".into()));
    let failed = grant_with(&facts(), |_, _| Err("нет файла".into()));
    assert_eq!(failed, Err("failed: нет файла".into()));
}

#[test]
fn state_json_uses_camel_case_and_stable_words() {
    let json = serde_json::to_value(render(&facts())).unwrap();
    assert_eq!(json["state"], "grantable");
    assert_eq!(json["reason"], "");
    assert_eq!(json["needsCoreRestart"], false);
    assert!(json["command"]
        .as_str()
        .unwrap()
        .starts_with("sudo setcap "));
    let mut app = facts();
    app.appimage = true;
    let json = serde_json::to_value(render(&app)).unwrap();
    assert_eq!(
        (json["state"].as_str(), json["reason"].as_str()),
        (Some("unavailable"), Some("appimage"))
    );
    assert_eq!(json["command"], "");
}

#[test]
fn windows_flow_is_ready_or_elevate() {
    assert_eq!(elevation_state(true).state, "ready");
    assert_eq!(elevation_state(false).state, "elevate");
    assert!(!elevation_state(false).needs_core_restart);
}
