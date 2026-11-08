// SPDX-License-Identifier: GPL-3.0-only

//! Цикл приёма соединений HTTP/1.1 поверх hyper.

use crate::handler::{route, AppState};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::{TokioIo, TokioTimer};
use std::{sync::Arc, time::Duration};
use tokio::net::TcpListener;

/// Таймаут чтения заголовков, как `ReadHeaderTimeout` в Go-ядре.
const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(10);

/// Принимает соединения до отмены задачи; каждое обслуживается отдельной задачей.
pub async fn serve(listener: TcpListener, st: Arc<AppState>) {
    loop {
        let Ok((sock, _)) = listener.accept().await else {
            continue;
        };
        let _ = sock.set_nodelay(true);
        let st = st.clone();
        tokio::spawn(async move {
            let svc = service_fn(move |req| route(req, st.clone()));
            let _ = http1::Builder::new()
                .timer(TokioTimer::new())
                .header_read_timeout(HEADER_READ_TIMEOUT)
                .serve_connection(TokioIo::new(sock), svc)
                .await;
        });
    }
}
