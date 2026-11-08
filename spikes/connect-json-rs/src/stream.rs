// SPDX-License-Identifier: GPL-3.0-only

//! Server-streaming Connect (`application/connect+json`): `SubscribeEvents`.

use crate::envelope::{self, encode};
use crate::error::{Code, ConnectError};
use crate::handler::{full, AppState, Body};
use crate::request::{media_type, parse_request, read_body};
use crate::status;
use bytes::Bytes;
use futures_util::stream::unfold;
use http_body_util::{BodyExt, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::header::{HeaderValue, CONTENT_TYPE};
use hyper::{Request, Response, StatusCode};
use std::{convert::Infallible, sync::Arc};
use tokio::sync::mpsc;

const CT: &str = "application/connect+json";
/// Тестовые значения `event_kinds`: короткая серия кадров и ошибка в end-stream.
pub const KIND_BURST: &str = "spike_burst";
pub const KIND_ERROR: &str = "spike_error";

/// Ответ с единственным end-stream кадром (ошибка до начала потока: HTTP 200 по Connect).
fn early_error(e: &ConnectError) -> Response<Body> {
    full(200, CT, envelope::end_stream(Some(e)))
}

pub async fn serve(req: Request<Incoming>, st: &Arc<AppState>) -> Response<Body> {
    if media_type(&req) != CT {
        let mut r = full(415, "text/plain; charset=utf-8", "");
        r.headers_mut()
            .insert("accept-post", HeaderValue::from_static(CT));
        return r;
    }
    let encoded = req
        .headers()
        .get("connect-content-encoding")
        .is_some_and(|v| v != "identity");
    if encoded {
        return early_error(&ConnectError::new(
            Code::Unimplemented,
            "Connect-Content-Encoding не поддерживается",
        ));
    }
    let kinds = match request_kinds(req).await {
        Ok(k) => k,
        Err(e) => return early_error(&e),
    };
    let (tx, rx) = mpsc::channel::<Bytes>(16);
    tokio::spawn(produce(tx, st.clone(), kinds));
    let frames = unfold(rx, |mut rx| async move {
        rx.recv()
            .await
            .map(|b| (Ok::<_, Infallible>(Frame::data(b)), rx))
    });
    let mut r = Response::new(StreamBody::new(frames).boxed());
    *r.status_mut() = StatusCode::OK;
    r.headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(CT));
    r
}

async fn request_kinds(req: Request<Incoming>) -> Result<Vec<String>, ConnectError> {
    let body = read_body(req).await?;
    let msg = envelope::decode_single(&body)?;
    let v = parse_request(msg)?;
    Ok(v["eventKinds"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|k| k.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default())
}

fn frame_of(st: &AppState) -> Bytes {
    let ev = status::state_changed_event(status::core_status(&st.core_version));
    encode(0, ev.to_string().as_bytes())
}

/// Производитель кадров: снимок первым; далее шина событий до ухода клиента.
async fn produce(tx: mpsc::Sender<Bytes>, st: Arc<AppState>, kinds: Vec<String>) {
    let mut bus = st.events.subscribe();
    if tx.send(frame_of(&st)).await.is_err() {
        return;
    }
    let has = |k: &str| kinds.iter().any(|x| x == k);
    if has(KIND_ERROR) {
        let e = ConnectError::new(Code::Internal, "тестовая ошибка потока");
        let _ = tx.send(envelope::end_stream(Some(&e))).await;
        return;
    }
    if has(KIND_BURST) {
        for _ in 0..3 {
            if tx.send(frame_of(&st)).await.is_err() {
                return;
            }
        }
        let _ = tx.send(envelope::end_stream(None)).await;
        return;
    }
    loop {
        tokio::select! {
            () = tx.closed() => return,
            ev = bus.recv() => match ev {
                Ok(b) => if tx.send(encode(0, &b)).await.is_err() { return },
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => {
                    let _ = tx.send(envelope::end_stream(None)).await;
                    return;
                }
            },
        }
    }
}
