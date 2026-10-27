//go:build singbox_run

package main

import "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/inst"

// pickRunner — сборка с реальным ядром (go build -tags singbox_run, плюс
// with_quic/with_gvisor по платформе): Connect поднимает настоящий sing-box.
func pickRunner() inst.Runner { return inst.NewSingBoxRunner() }
