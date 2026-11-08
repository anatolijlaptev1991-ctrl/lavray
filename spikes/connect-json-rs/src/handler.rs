// SPDX-License-Identifier: GPL-3.0-only

//! Маршрутизация, авторизация и unary-вызовы Connect (JSON).

use crate::request::{media_type, parse_request, read_body, timeout_of};
use crate::{
    auth, cors,
    error::{Code, ConnectError},
    status, stream,
};
use bytes::Bytes;
use http_body_util::{combinators::BoxBody, BodyExt, Empty, Full};
use hyper::body::Incoming;
use hyper::header::{HeaderValue, ALLOW, AUTHORIZATION, CONTENT_TYPE, ORIGIN};
use hyper::{Method, Request, Response, StatusCode};
use std::{convert::Infallible, sync::Arc};
use tokio::sync::broadcast;

/// Тип тела ответа (единый для unary и стрима).
pub type Body = BoxBody<Bytes, Infallible>;

/// Общее состояние сервера.
pub struct AppState {
    pub token: String,
    pub core_version: String,
    /// Шина событий для `SubscribeEvents` (в спайке публикует только тест).
    pub events: broadcast::Sender<Bytes>,
}

pub(crate) const GET_STATUS: &str = "/lavray.v1.CoreService/GetStatus";
pub(crate) const SUBSCRIBE: &str = "/lavray.v1.CoreService/SubscribeEvents";
/// Самый дешёвый RPC Go-ядра без обращения к БД (`ProfileService.StopTests`).
pub(crate) const STOP_TESTS: &str = "/lavray.v1.ProfileService/StopTests";
const ACCEPT_POST: &str = "application/json, application/json; charset=utf-8";

pub(crate) fn full(
    status: u16,
    content_type: &'static str,
    body: impl Into<Bytes>,
) -> Response<Body> {
    let mut r = Response::new(Full::new(body.into()).boxed());
    *r.status_mut() = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    r.headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    r
}

fn empty(status: StatusCode) -> Response<Body> {
    let mut r = Response::new(Empty::<Bytes>::new().boxed());
    *r.status_mut() = status;
    r
}

/// Точка входа hyper: `/healthz`, preflight, авторизация, CORS, RPC.
pub async fn route(
    req: Request<Incoming>,
    st: Arc<AppState>,
) -> Result<Response<Body>, Infallible> {
    let origin = req
        .headers()
        .get(ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    if req.uri().path() == "/healthz" {
        return Ok(empty(StatusCode::OK));
    }
    if req.method() == Method::OPTIONS {
        let mut r = empty(StatusCode::NO_CONTENT);
        cors::apply(origin.as_deref(), r.headers_mut());
        return Ok(r);
    }
    let hdr = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    if !auth::is_authorized(hdr, &st.token) {
        let mut r = full(401, "text/plain; charset=utf-8", auth::UNAUTHENTICATED_BODY);
        r.headers_mut().insert(
            "x-content-type-options",
            HeaderValue::from_static("nosniff"),
        );
        return Ok(r);
    }
    let mut r = rpc(req, &st).await;
    cors::apply(origin.as_deref(), r.headers_mut());
    Ok(r)
}

async fn rpc(req: Request<Incoming>, st: &Arc<AppState>) -> Response<Body> {
    if req.method() != Method::POST {
        let mut r = empty(StatusCode::METHOD_NOT_ALLOWED);
        r.headers_mut()
            .insert(ALLOW, HeaderValue::from_static("POST"));
        return r;
    }
    match req.uri().path() {
        GET_STATUS | STOP_TESTS => unary(req, st).await,
        SUBSCRIBE => stream::serve(req, st).await,
        _ => full(404, "text/plain; charset=utf-8", "404 page not found\n"),
    }
}

pub(crate) fn error_response(e: &ConnectError) -> Response<Body> {
    full(e.code.http_status(), "application/json", e.to_json())
}

async fn unary(req: Request<Incoming>, st: &Arc<AppState>) -> Response<Body> {
    if media_type(&req) != "application/json" {
        let mut r = empty(StatusCode::UNSUPPORTED_MEDIA_TYPE);
        r.headers_mut()
            .insert("accept-post", HeaderValue::from_static(ACCEPT_POST));
        return r;
    }
    let deadline = timeout_of(&req);
    let encoded = req
        .headers()
        .get("content-encoding")
        .is_some_and(|v| v != "identity");
    let path = req.uri().path().to_owned();
    let work = async {
        if encoded {
            return Err(ConnectError::new(
                Code::Unimplemented,
                "Content-Encoding не поддерживается",
            ));
        }
        let body = read_body(req).await?;
        parse_request(&body)?;
        Ok(match path.as_str() {
            GET_STATUS => status::core_status(&st.core_version).to_string(),
            _ => "{}".to_owned(),
        })
    };
    let out = match deadline {
        Some(d) => tokio::time::timeout(d, work).await.unwrap_or_else(|_| {
            Err(ConnectError::new(
                Code::DeadlineExceeded,
                "истёк Connect-Timeout-Ms",
            ))
        }),
        None => work.await,
    };
    match out {
        Ok(json) => full(200, "application/json", json),
        Err(e) => error_response(&e),
    }
}
