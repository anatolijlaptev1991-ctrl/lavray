// SPDX-License-Identifier: GPL-3.0-only

//! Server-streaming: снимок, end-stream, ошибки, события шины.

mod common;
use bytes::Bytes;
use common::*;
use http_body_util::{BodyExt, Full};
use hyper::{client::conn::http1, Request};
use hyper_util::rt::TokioIo;
use tokio::net::TcpStream;

#[tokio::test]
async fn stream_snapshot_burst_and_end_frame() {
    let (addr, _) = start().await;
    let body = env(0, r#"{"eventKinds":["spike_burst"]}"#);
    let r = call(addr, EVENTS, "application/connect+json", bearer(), body).await;
    assert_eq!((r.status, r.ct.as_str()), (200, "application/connect+json"));
    let f = frames(&r.body);
    assert_eq!(f.len(), 5, "снимок + 3 события + end-stream");
    assert!(f[..4]
        .iter()
        .all(|(fl, v)| *fl == 0 && v["stateChanged"]["coreVersion"] == "9.9.9"));
    assert!(f[0].1["tsMs"].is_string(), "int64 строкой");
    assert_eq!((f[4].0, &f[4].1), (2, &serde_json::json!({})));
}

#[tokio::test]
async fn stream_error_goes_to_end_stream_frame() {
    let (addr, _) = start().await;
    let r = call(
        addr,
        EVENTS,
        "application/connect+json",
        bearer(),
        env(0, r#"{"eventKinds":["spike_error"]}"#),
    )
    .await;
    let f = frames(&r.body);
    assert_eq!(f.len(), 2);
    assert_eq!(f[1].0, 2);
    assert_eq!(f[1].1["error"]["code"], "internal");
    let r = call(
        addr,
        EVENTS,
        "application/connect+json",
        bearer(),
        env(1, "{}"),
    )
    .await;
    assert_eq!(r.status, 200);
    assert_eq!(frames(&r.body)[0].1["error"]["code"], "unimplemented");
}

#[tokio::test]
async fn stream_forwards_bus_events_incrementally() {
    let (addr, st) = start().await;
    let io = TokioIo::new(TcpStream::connect(addr).await.unwrap());
    let (mut tx, conn) = http1::handshake(io).await.unwrap();
    tokio::spawn(conn);
    let req = Request::post(EVENTS)
        .header("host", "x")
        .header("content-type", "application/connect+json")
        .header("authorization", "Bearer test-token")
        .body(Full::new(Bytes::from(env(0, "{}"))))
        .unwrap();
    let mut body = tx.send_request(req).await.unwrap().into_body();
    let mut got = Vec::new();
    let mut sent = false;
    while frames(&got).len() < 2 {
        let chunk = body
            .frame()
            .await
            .expect("поток не должен закрыться")
            .unwrap();
        got.extend(chunk.into_data().unwrap());
        if !sent {
            // первый кадр (снимок) получен, поток открыт: публикуем событие
            st.events
                .send(Bytes::from_static(
                    br#"{"tsMs":"1","shutdownImminent":"x"}"#,
                ))
                .unwrap();
            sent = true;
        }
    }
    let f = frames(&got);
    assert_eq!(f[0].1["stateChanged"]["coreVersion"], "9.9.9");
    assert_eq!(f[1].1["shutdownImminent"], "x");
}
