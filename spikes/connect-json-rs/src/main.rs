// SPDX-License-Identifier: GPL-3.0-only

//! `connect-spike serve [--listen 127.0.0.1:0] [--core-version 0.9.2]`: токен одной
//! строкой со stdin, затем `LAVRAY_CORE_READY tcp://адрес`; выход по EOF stdin (как у Go-ядра).

use connect_spike::{handler::AppState, server};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::broadcast;

fn arg(args: &[String], name: &str, default: &str) -> String {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_else(|| default.to_owned())
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let listen = arg(&args, "--listen", "127.0.0.1:0");
    let mut stdin = BufReader::new(tokio::io::stdin());
    let mut token = String::new();
    stdin.read_line(&mut token).await?;
    let (events, _) = broadcast::channel(64);
    let st = Arc::new(AppState {
        token: token.trim().to_owned(),
        core_version: arg(&args, "--core-version", "0.9.2"),
        events,
    });
    let listener = TcpListener::bind(&listen).await?;
    println!("LAVRAY_CORE_READY tcp://{}", listener.local_addr()?);
    let mut rest = Vec::new();
    tokio::select! {
        () = server::serve(listener, st) => {}
        _ = stdin.read_to_end(&mut rest) => {}
    }
    Ok(())
}
