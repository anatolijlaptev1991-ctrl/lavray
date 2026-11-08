// SPDX-License-Identifier: GPL-3.0-only

//! Общие помощники интеграционных тестов: настоящий сервер на loopback, клиент — hyper.
#![allow(dead_code)]

use bytes::Bytes;
use connect_spike::{handler::AppState, server};
use http_body_util::{BodyExt, Full};
use hyper::{client::conn::http1, Request};
use hyper_util::rt::TokioIo;
use std::sync::Arc;
use tokio::{
    net::{TcpListener, TcpStream},
    sync::broadcast,
};

pub const TOKEN: &str = "test-token";
pub const STATUS: &str = "/lavray.v1.CoreService/GetStatus";
pub const EVENTS: &str = "/lavray.v1.CoreService/SubscribeEvents";

pub async fn start() -> (std::net::SocketAddr, Arc<AppState>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (events, _) = broadcast::channel(8);
    let st = Arc::new(AppState {
        token: TOKEN.into(),
        core_version: "9.9.9".into(),
        events,
    });
    tokio::spawn(server::serve(listener, st.clone()));
    (addr, st)
}

pub struct Reply {
    pub status: u16,
    pub ct: String,
    pub body: Bytes,
}

pub async fn call(
    addr: std::net::SocketAddr,
    path: &str,
    ct: &str,
    auth: Option<&str>,
    body: Vec<u8>,
) -> Reply {
    let io = TokioIo::new(TcpStream::connect(addr).await.unwrap());
    let (mut tx, conn) = http1::handshake(io).await.unwrap();
    tokio::spawn(conn);
    let mut b = Request::post(path)
        .header("host", "x")
        .header("content-type", ct);
    if let Some(a) = auth {
        b = b.header("authorization", a);
    }
    let resp = tx
        .send_request(b.body(Full::new(Bytes::from(body))).unwrap())
        .await
        .unwrap();
    let status = resp.status().as_u16();
    let ct = resp
        .headers()
        .get("content-type")
        .map(|v| v.to_str().unwrap().to_owned())
        .unwrap_or_default();
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    Reply { status, ct, body }
}

pub fn bearer() -> Option<&'static str> {
    Some("Bearer test-token")
}

pub fn env(flags: u8, json: &str) -> Vec<u8> {
    let mut v = vec![flags];
    v.extend((json.len() as u32).to_be_bytes());
    v.extend(json.as_bytes());
    v
}

/// Делит тело стрима на (флаги, JSON).
pub fn frames(mut b: &[u8]) -> Vec<(u8, serde_json::Value)> {
    let mut out = vec![];
    while !b.is_empty() {
        let n = u32::from_be_bytes([b[1], b[2], b[3], b[4]]) as usize;
        out.push((b[0], serde_json::from_slice(&b[5..5 + n]).unwrap()));
        b = &b[5 + n..];
    }
    out
}
