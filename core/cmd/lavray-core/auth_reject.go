// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"net/http"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/web"
)

// rejectUnauthenticated — 401 с дочитанным телом запроса: иначе клиент с
// Connection: close на Windows иногда получал RST вместо ответа (D-4, см.
// web.DiscardBody).
func rejectUnauthenticated(w http.ResponseWriter, r *http.Request) {
	web.DiscardBody(r)
	http.Error(w, `{"code":"unauthenticated"}`, http.StatusUnauthorized)
}
