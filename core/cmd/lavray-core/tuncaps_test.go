// SPDX-License-Identifier: GPL-3.0-only

package main

import "testing"

func TestHasEffectiveCap(t *testing.T) {
	cases := map[string]struct {
		status string
		want   bool
	}{
		"файловая cap_net_admin+ep (живая машина)": {"Name:\tlavray-core\nCapInh:\t0000000000000000\nCapPrm:\t0000000000001000\nCapEff:\t0000000000001000\n", true},
		"cap_net_admin и cap_net_bind_service":     {"CapEff:\t0000000000001400\n", true},
		"root, все права":                          {"CapEff:\t000001ffffffffff\n", true},
		"обычный процесс без прав":                 {"CapPrm:\t0000000000000000\nCapEff:\t0000000000000000\n", false},
		"только cap_net_bind_service":              {"CapEff:\t0000000000000400\n", false},
		"право есть в CapPrm, но не в CapEff":      {"CapPrm:\t0000000000001000\nCapEff:\t0000000000000000\n", false},
		"нет строки CapEff":                        {"Name:\tx\n", false},
		"мусор вместо маски":                       {"CapEff:\tzz\n", false},
		"пустая строка":                            {"", false},
	}
	for name, c := range cases {
		if got := hasEffectiveCap(c.status, capNetAdmin); got != c.want {
			t.Errorf("%s: hasEffectiveCap = %v, ждём %v", name, got, c.want)
		}
	}
	if hasEffectiveCap("CapEff:\tffffffffffffffff\n", 64) {
		t.Error("номер capability вне маски должен давать false")
	}
}
