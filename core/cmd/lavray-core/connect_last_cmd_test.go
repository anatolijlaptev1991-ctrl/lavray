// SPDX-License-Identifier: GPL-3.0-only

package main

import "testing"

func TestCheckConnectFlags(t *testing.T) {
	cases := []struct {
		headless, connectLast, wantErr bool
	}{
		{false, false, false},
		{true, false, false},
		{false, true, false},
		{true, true, true},
	}
	for _, c := range cases {
		err := checkConnectFlags(c.headless, c.connectLast)
		if (err != nil) != c.wantErr {
			t.Errorf("headless=%v connect-last=%v: err=%v, ожидалась ошибка=%v", c.headless, c.connectLast, err, c.wantErr)
		}
	}
}
