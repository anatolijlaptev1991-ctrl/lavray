// SPDX-License-Identifier: GPL-3.0-only

package main

import "strings"

// bearerToken извлекает токен из заголовка «Authorization: Bearer <токен>»
// (T-53, A1-20). Схема нечувствительна к регистру (RFC 7235), между схемой и
// токеном допускается любое число пробелов. Ok=false — заголовок пуст, схема
// не Bearer или нет пробела после неё: такой запрос не авторизован, даже если
// сам заголовок равен токену (раньше TrimPrefix пропускал и голый токен).
func bearerToken(header string) (token string, ok bool) {
	scheme, rest, found := strings.Cut(header, " ")
	if !found || !strings.EqualFold(scheme, "Bearer") {
		return "", false
	}
	return strings.TrimLeft(rest, " "), true
}
