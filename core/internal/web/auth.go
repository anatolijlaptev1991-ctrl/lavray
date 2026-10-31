// SPDX-License-Identifier: GPL-3.0-only

package web

// auth.go — сценарии входа: связывает пользователей, сессии и лимитер. Слой
// api вызывает эти методы из RPC WebSessionService и сам переводит ошибки в
// коды Connect.

import "errors"

// ClientInfo — кто входит: адрес для лимитера и метка клиента для списка сессий.
type ClientInfo struct {
	IP    string
	Label string
}

// LoginResult — открытая сессия и токен для cookie.
type LoginResult struct {
	Token   string
	Session Session
}

// Auth — вход, первичная настройка и смена пароля.
type Auth struct {
	Users    *Users
	Sessions *Sessions
	Limiter  *Limiter
}

// NewAuth собирает сервис из частей.
func NewAuth(users *Users, sessions *Sessions, limiter *Limiter) *Auth {
	return &Auth{Users: users, Sessions: sessions, Limiter: limiter}
}

// Login проверяет пароль под защитой лимитера и открывает сессию. Ошибки:
// *RateLimitError (пауза), ErrNoAdmin (нужна настройка), ErrBadCredentials.
func (a *Auth) Login(username, password string, c ClientInfo) (LoginResult, error) {
	if wait := a.Limiter.Allow(username, c.IP); wait > 0 {
		return LoginResult{}, &RateLimitError{After: wait}
	}
	rec, err := a.Users.Authenticate(username, password)
	if errors.Is(err, ErrBadCredentials) {
		a.Limiter.Failure(username, c.IP)
	}
	if err != nil {
		return LoginResult{}, err
	}
	a.Limiter.Success(username, c.IP)
	return a.open(rec, c)
}

// SetupFirstAdmin создаёт первого администратора и сразу открывает сессию.
// Работает один раз: повтор — ErrAdminExists. Попытки учитываются общим лимитом.
func (a *Auth) SetupFirstAdmin(username, password string, c ClientInfo) (LoginResult, error) {
	if wait := a.Limiter.Allow("\x00setup", c.IP); wait > 0 {
		return LoginResult{}, &RateLimitError{After: wait}
	}
	rec, err := a.Users.CreateFirstAdmin(username, password)
	if err != nil {
		return LoginResult{}, err
	}
	return a.open(rec, c)
}

func (a *Auth) open(rec UserRecord, c ClientInfo) (LoginResult, error) {
	token, sess, err := a.Sessions.Create(rec, c.Label, c.IP)
	if err != nil {
		return LoginResult{}, err
	}
	return LoginResult{Token: token, Session: sess}, nil
}

// ChangePassword меняет пароль пользователя сессии sess и отзывает все его
// остальные сессии; возвращает их число. Неверный прежний пароль считается
// неудачей входа: украденной сессией пароль не подобрать.
func (a *Auth) ChangePassword(sess Session, oldPassword, newPassword, ip string) (int, error) {
	if wait := a.Limiter.Allow(sess.Username, ip); wait > 0 {
		return 0, &RateLimitError{After: wait}
	}
	err := a.Users.ChangePassword(sess.Username, oldPassword, newPassword)
	if errors.Is(err, ErrBadCredentials) {
		a.Limiter.Failure(sess.Username, ip)
	}
	if err != nil {
		return 0, err
	}
	a.Limiter.Success(sess.Username, ip)
	return a.Sessions.RevokeOthers(sess.UserID, sess.ID), nil
}
