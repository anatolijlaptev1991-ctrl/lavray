// SPDX-License-Identifier: GPL-3.0-only

package web

import (
	"errors"
	"testing"
	"time"
)

func newTestAuth(t *testing.T) (*Auth, *fakeClock) {
	t.Helper()
	clk := newFakeClock()
	users, _ := newUsers(t)
	return NewAuth(users, NewSessions(clk.Now), NewLimiter(clk.Now, LimiterConfig{})), clk
}

var lan = ClientInfo{IP: "192.168.1.50", Label: "Firefox"}

func TestAuthSetupAndLogin(t *testing.T) {
	a, _ := newTestAuth(t)
	if _, err := a.Login("admin", goodPass, lan); !errors.Is(err, ErrNoAdmin) {
		t.Fatalf("вход до настройки: %v", err)
	}
	setup, err := a.SetupFirstAdmin("admin", goodPass, lan)
	if err != nil || setup.Token == "" || setup.Session.Username != "admin" {
		t.Fatalf("настройка: %+v err=%v", setup, err)
	}
	if _, err := a.SetupFirstAdmin("admin2", goodPass, lan); !errors.Is(err, ErrAdminExists) {
		t.Fatalf("повторная настройка: %v", err)
	}
	res, err := a.Login("admin", goodPass, lan)
	if err != nil || res.Token == setup.Token {
		t.Fatalf("вход: %+v err=%v", res, err)
	}
	if _, ok := a.Sessions.Validate(res.Token); !ok {
		t.Fatal("сессия после входа не действует")
	}
	if _, err := a.SetupFirstAdmin("x", "short", lan); !errors.Is(err, ErrWeakPassword) {
		t.Fatalf("слабый пароль: %v", err)
	}
}

// TestAuthLockout — неудачи копятся по записи и закрывают вход даже верному
// паролю, пока не пройдёт пауза.
func TestAuthLockout(t *testing.T) {
	a, clk := newTestAuth(t)
	if _, err := a.SetupFirstAdmin("admin", goodPass, lan); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		if _, err := a.Login("admin", "wrong-password-1", lan); !errors.Is(err, ErrBadCredentials) {
			t.Fatalf("неудача %d: %v", i+1, err)
		}
	}
	_, err := a.Login("admin", goodPass, lan)
	var rl *RateLimitError
	if !errors.As(err, &rl) || rl.RetrySeconds() != 1 {
		t.Fatalf("после 5 неудач верный пароль: err=%v", err)
	}
	clk.Advance(time.Second)
	if _, err := a.Login("admin", goodPass, lan); err != nil {
		t.Fatalf("после паузы: %v", err)
	}
}

func TestAuthUnknownUserCountsAsFailure(t *testing.T) {
	a, _ := newTestAuth(t)
	_, _ = a.SetupFirstAdmin("admin", goodPass, lan)
	for i := 0; i < 5; i++ {
		_, _ = a.Login("ghost", "whatever-pass-1", lan)
	}
	var rl *RateLimitError
	if _, err := a.Login("ghost", goodPass, lan); !errors.As(err, &rl) {
		t.Fatalf("перебор несуществующего имени не ограничен: %v", err)
	}
}

// TestChangePasswordRevokesOthers — смена пароля гасит все сессии, кроме текущей.
func TestChangePasswordRevokesOthers(t *testing.T) {
	a, _ := newTestAuth(t)
	cur, _ := a.SetupFirstAdmin("admin", goodPass, lan)
	other1, _ := a.Login("admin", goodPass, lan)
	other2, _ := a.Login("admin", goodPass, lan)

	if _, err := a.ChangePassword(cur.Session, "wrong-password-1", "brand-new-pass-1", lan.IP); !errors.Is(err, ErrBadCredentials) {
		t.Fatalf("неверный прежний пароль: %v", err)
	}
	n, err := a.ChangePassword(cur.Session, goodPass, "brand-new-pass-1", lan.IP)
	if err != nil || n != 2 {
		t.Fatalf("revoked=%d err=%v", n, err)
	}
	if _, ok := a.Sessions.Validate(cur.Token); !ok {
		t.Fatal("текущая сессия отозвана")
	}
	for _, tok := range []string{other1.Token, other2.Token} {
		if _, ok := a.Sessions.Validate(tok); ok {
			t.Fatal("чужая сессия пережила смену пароля")
		}
	}
	if _, err := a.Login("admin", "brand-new-pass-1", lan); err != nil {
		t.Fatalf("новый пароль: %v", err)
	}
}
