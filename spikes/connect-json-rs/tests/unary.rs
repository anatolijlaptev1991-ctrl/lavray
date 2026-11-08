// SPDX-License-Identifier: GPL-3.0-only

//! Unary: GetStatus, 401, ошибки Connect.

mod common;
use common::*;

#[tokio::test]
async fn unary_get_status() {
    let (addr, _) = start().await;
    let r = call(addr, STATUS, "application/json", bearer(), b"{}".to_vec()).await;
    assert_eq!((r.status, r.ct.as_str()), (200, "application/json"));
    let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!(v["coreVersion"], "9.9.9");
    assert_eq!(v["inbound"]["port"], 2080);
    assert!(
        v.get("state").is_none(),
        "нулевой enum опущен, как в protojson"
    );
}

#[tokio::test]
async fn unauthenticated_is_401() {
    let (addr, _) = start().await;
    for auth in [
        None,
        Some("Bearer wrong"),
        Some(TOKEN),
        Some("Basic test-token"),
    ] {
        let r = call(addr, STATUS, "application/json", auth, b"{}".to_vec()).await;
        assert_eq!(r.status, 401, "{auth:?}");
        assert_eq!(&r.body[..], b"{\"code\":\"unauthenticated\"}\n");
    }
    let r = call(addr, EVENTS, "application/connect+json", None, env(0, "{}")).await;
    assert_eq!(r.status, 401);
}

#[tokio::test]
async fn unary_errors_use_connect_json() {
    let (addr, _) = start().await;
    let r = call(addr, STATUS, "application/json", bearer(), b"{bad".to_vec()).await;
    assert_eq!(r.status, 400);
    let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!(v["code"], "invalid_argument");
    assert!(v["message"].is_string());
    assert_eq!(
        call(addr, STATUS, "text/plain", bearer(), vec![])
            .await
            .status,
        415
    );
    assert_eq!(
        call(
            addr,
            "/lavray.v1.CoreService/Nope",
            "application/json",
            bearer(),
            vec![]
        )
        .await
        .status,
        404
    );
    let r = call(
        addr,
        "/lavray.v1.ProfileService/StopTests",
        "application/json",
        bearer(),
        vec![],
    )
    .await;
    assert_eq!((r.status, &r.body[..]), (200, &b"{}"[..]));
}
