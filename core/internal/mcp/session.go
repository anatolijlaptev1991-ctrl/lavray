// SPDX-License-Identifier: GPL-3.0-only

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"connectrpc.com/connect"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1connect"
)

// EndpointFileName — имя файла с адресом и агентским токеном в каталоге данных.
const EndpointFileName = "agent-endpoint.json"

// maxEndpointFileBytes — файл больше этого размера не читается.
const maxEndpointFileBytes = 16 << 10

// MsgNotRunning — ответ инструментов, когда приложения нет или доступ выключен.
const MsgNotRunning = "LAVRay не запущен или доступ для агентов выключен: откройте LAVRay → Настройки → Агенты (MCP)"

// ErrNotRunning — приложение не запущено или доступ агентов выключен.
var ErrNotRunning = errors.New(MsgNotRunning)

// Endpoint — содержимое agent-endpoint.json: адрес ядра, агентский токен и
// режим доступа. Файл пишет оболочка с правами только для пользователя и SYSTEM.
type Endpoint struct {
	URL   string `json:"url"`
	Token string `json:"token"`
	Mode  string `json:"mode"`
}

// ReadEndpoint читает и проверяет файл. Нет файла, пустое или выключенное
// состояние — ErrNotRunning. Адрес обязан быть loopback: токен нельзя
// отправлять куда-либо ещё, даже если файл подменили.
func ReadEndpoint(path string) (Endpoint, error) {
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Endpoint{}, ErrNotRunning
		}
		return Endpoint{}, fmt.Errorf("agent-endpoint.json не читается: %w", err)
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, maxEndpointFileBytes+1))
	if err != nil {
		return Endpoint{}, fmt.Errorf("agent-endpoint.json не читается: %w", err)
	}
	if len(raw) > maxEndpointFileBytes {
		return Endpoint{}, errors.New("agent-endpoint.json слишком большой: перезапустите LAVRay")
	}
	var ep Endpoint
	if err := json.Unmarshal(raw, &ep); err != nil {
		return Endpoint{}, errors.New("agent-endpoint.json повреждён: перезапустите LAVRay")
	}
	if ep.Mode != "read" && ep.Mode != "control" {
		return Endpoint{}, ErrNotRunning
	}
	if ep.Token == "" {
		return Endpoint{}, errors.New("agent-endpoint.json без токена: перезапустите LAVRay")
	}
	if _, err := baseURL(ep.URL); err != nil {
		return Endpoint{}, err
	}
	return ep, nil
}

// baseURL приводит tcp://127.0.0.1:порт к http://127.0.0.1:порт и отвергает
// всё, кроме loopback.
func baseURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "tcp" && u.Scheme != "http") || u.Host == "" {
		return "", errors.New("agent-endpoint.json: адрес ядра должен быть вида tcp://127.0.0.1:порт")
	}
	host, _, err := net.SplitHostPort(u.Host)
	if err != nil {
		return "", errors.New("agent-endpoint.json: в адресе ядра нет порта")
	}
	if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
		return "", errors.New("agent-endpoint.json: адрес ядра не loopback — токен не отправляется")
	}
	return "http://" + u.Host, nil
}

// Session — клиенты ядра для одного вызова инструмента.
type Session struct {
	Mode string
	// transport держит соединения с ядром; общий для вызовов с тем же адресом
	// и токеном, чтобы каждый вызов не открывал новое.
	transport *http.Transport
	Core      lavrayv1connect.CoreServiceClient
	Profile   lavrayv1connect.ProfileServiceClient
	Subs      lavrayv1connect.SubscriptionServiceClient
	Stats     lavrayv1connect.StatsServiceClient
	Logs      lavrayv1connect.LogServiceClient
	Diag      lavrayv1connect.DiagnosticsServiceClient
	// Dir — каталог файла с адресом (рядом лежит ui-state.json).
	Dir string
}

// bearerTransport добавляет агентский токен к каждому запросу.
type bearerTransport struct {
	token string
	base  http.RoundTripper
}

func (t bearerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+t.token)
	return t.base.RoundTrip(r)
}

// newSession строит клиентов ядра по файлу адреса.
func newSession(ep Endpoint, dir string) (*Session, error) {
	base, err := baseURL(ep.URL)
	if err != nil {
		return nil, err
	}
	// Proxy не задан: запросы к ядру идут напрямую, а не в системный прокси.
	transport := &http.Transport{
		Proxy:               nil,
		DialContext:         (&net.Dialer{Timeout: 3 * time.Second}).DialContext,
		MaxIdleConnsPerHost: 4,
		IdleConnTimeout:     30 * time.Second,
	}
	hc := &http.Client{Transport: bearerTransport{token: ep.Token, base: transport}}
	return &Session{
		Mode:      ep.Mode,
		transport: transport,
		Dir:       dir,
		Core:      lavrayv1connect.NewCoreServiceClient(hc, base),
		Profile:   lavrayv1connect.NewProfileServiceClient(hc, base),
		Subs:      lavrayv1connect.NewSubscriptionServiceClient(hc, base),
		Stats:     lavrayv1connect.NewStatsServiceClient(hc, base),
		Logs:      lavrayv1connect.NewLogServiceClient(hc, base),
		Diag:      lavrayv1connect.NewDiagnosticsServiceClient(hc, base),
	}, nil
}

// isTransport — ошибка соединения с ядром (отказ, обрыв), а не ответ ядра.
func isTransport(err error) bool {
	var urlErr *url.Error
	var opErr *net.OpError
	return errors.As(err, &urlErr) || errors.As(err, &opErr) ||
		errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)
}

// explain превращает ошибку ядра в понятный агенту текст.
func explain(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return errors.New("ядро не ответило вовремя")
	}
	if errors.Is(err, context.Canceled) {
		return err
	}
	var ce *connect.Error
	if errors.As(err, &ce) {
		switch {
		case ce.Code() == connect.CodeUnauthenticated, isTransport(ce):
			// токен прежнего запуска ядра или ядро уже закрылось
			return ErrNotRunning
		case ce.Code() == connect.CodePermissionDenied, ce.Code() == connect.CodeFailedPrecondition,
			ce.Code() == connect.CodeInvalidArgument, ce.Code() == connect.CodeNotFound:
			return errors.New(ce.Message())
		}
		return fmt.Errorf("ядро вернуло ошибку (%s): %s", strings.ToLower(ce.Code().String()), ce.Message())
	}
	if isTransport(err) {
		return ErrNotRunning
	}
	return err
}
