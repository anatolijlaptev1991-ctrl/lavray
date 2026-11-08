// SPDX-License-Identifier: GPL-3.0-only

//! Нативный генератор нагрузки (низкие накладные расходы клиента, в отличие от Node):
//! `loadgen URL TOKEN PATH [--seq 10000] [--workers 50] [--per 200]`.
//! Печатает одну строку JSON: задержки в мкс для последовательного и параллельного режимов.

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::{client::conn::http1, Request};
use hyper_util::rt::TokioIo;
use std::time::Instant;
use tokio::net::TcpStream;

type Sender = http1::SendRequest<Full<Bytes>>;

async fn connect(addr: &str) -> Sender {
    let sock = TcpStream::connect(addr).await.expect("connect");
    sock.set_nodelay(true).ok();
    let (tx, conn) = http1::handshake(TokioIo::new(sock))
        .await
        .expect("handshake");
    tokio::spawn(conn);
    tx
}

/// `n` вызовов по одному соединению; задержки в мкс.
async fn run(addr: &str, token: &str, path: &str, n: usize) -> Vec<f64> {
    let mut tx = connect(addr).await;
    let mut lat = Vec::with_capacity(n);
    for _ in 0..n {
        let req = Request::post(path)
            .header("host", addr)
            .header("authorization", format!("Bearer {token}"))
            .header("content-type", "application/json")
            .body(Full::new(Bytes::from_static(b"{}")))
            .expect("request");
        let t0 = Instant::now();
        tx.ready().await.expect("ready");
        let resp = tx.send_request(req).await.expect("send");
        assert_eq!(resp.status(), 200);
        resp.into_body().collect().await.expect("body");
        lat.push(t0.elapsed().as_secs_f64() * 1e6);
    }
    lat
}

fn stats(mut v: Vec<f64>) -> serde_json::Value {
    v.sort_by(f64::total_cmp);
    let at = |p: usize| v[(v.len() * p / 100).min(v.len() - 1)];
    let mean = v.iter().sum::<f64>() / v.len() as f64;
    serde_json::json!({"p50": at(50), "p99": at(99), "mean": mean, "max": v[v.len() - 1]})
}

fn flag(args: &[String], name: &str, default: usize) -> usize {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1)?.parse().ok())
        .unwrap_or(default)
}

#[tokio::main(flavor = "multi_thread", worker_threads = 4)]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let addr = args[0].trim_start_matches("http://").to_owned();
    let (token, path) = (args[1].clone(), args[2].clone());
    let (seq, workers, per) = (
        flag(&args, "--seq", 10_000),
        flag(&args, "--workers", 50),
        flag(&args, "--per", 200),
    );
    run(&addr, &token, &path, 1000).await; // прогрев
    let seq_lat = run(&addr, &token, &path, seq).await;
    let t0 = Instant::now();
    let tasks: Vec<_> = (0..workers)
        .map(|_| {
            let (a, t, p) = (addr.clone(), token.clone(), path.clone());
            tokio::spawn(async move { run(&a, &t, &p, per).await })
        })
        .collect();
    let mut par_lat = Vec::new();
    for t in tasks {
        par_lat.extend(t.await.expect("worker"));
    }
    let rps = (workers * per) as f64 / t0.elapsed().as_secs_f64();
    let mut par = stats(par_lat);
    par["rps"] = rps.into();
    println!("{}", serde_json::json!({"seq": stats(seq_lat), "par": par}));
}
