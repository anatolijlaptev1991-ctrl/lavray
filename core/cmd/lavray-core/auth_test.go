// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/logs"
)

// T-53 (A1-20): авторизация требует схему «Bearer». Раньше заголовок
// «Authorization: <токен>» без схемы тоже давал 200.
func TestAuthMiddlewareRequiresBearerScheme(t *testing.T) {
	const token = "t53-secret-token-0123456789"
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := authMiddleware(ok, token, logs.NewMux(10))

	cases := []struct {
		name   string
		header string
		want   int
	}{
		{"верный токен со схемой Bearer", "Bearer " + token, http.StatusOK},
		{"схема в нижнем регистре", "bearer " + token, http.StatusOK},
		{"несколько пробелов после схемы", "Bearer   " + token, http.StatusOK},
		{"токен без схемы", token, http.StatusUnauthorized},
		{"токен вместо схемы", token + " " + token, http.StatusUnauthorized},
		{"другая схема", "Basic " + token, http.StatusUnauthorized},
		{"Bearer без токена", "Bearer ", http.StatusUnauthorized},
		{"Bearer без пробела", "Bearer", http.StatusUnauthorized},
		{"чужой токен", "Bearer wrong", http.StatusUnauthorized},
		{"заголовка нет", "", http.StatusUnauthorized},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodPost, "/lavray.v1.CoreService/GetStatus", nil)
		if c.header != "" {
			req.Header.Set("Authorization", c.header)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != c.want {
			t.Errorf("%s (Authorization=%q): статус %d, ожидался %d", c.name, c.header, rec.Code, c.want)
		}
	}

	// /healthz открыт, предзапрос CORS (OPTIONS) не несёт Authorization.
	for _, probe := range []struct{ method, path string }{
		{http.MethodGet, "/healthz"}, {http.MethodOptions, "/lavray.v1.CoreService/GetStatus"},
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(probe.method, probe.path, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("%s %s без токена: статус %d, ожидался 200", probe.method, probe.path, rec.Code)
		}
	}
}

// Пустой токен ядра (оболочка не передала секрет) отвергает всех, в том числе
// «Bearer» с пустым значением и с любым значением.
func TestAuthMiddlewareEmptyTokenRejectsEverything(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := authMiddleware(ok, "", logs.NewMux(10))
	for _, header := range []string{"", "Bearer ", "Bearer x", "x"} {
		req := httptest.NewRequest(http.MethodPost, "/lavray.v1.CoreService/GetStatus", nil)
		if header != "" {
			req.Header.Set("Authorization", header)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("Authorization=%q при пустом токене ядра: статус %d, ожидался 401", header, rec.Code)
		}
	}
}
