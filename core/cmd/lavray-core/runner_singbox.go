//go:build singbox_run

package main

import "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/inst"

// pickRunner — сборка с реальным ядром: Connect поднимает настоящий sing-box.
// Полный список тегов сборки — единый файл core/BUILD_TAGS (singbox_run,
// with_quic, with_gvisor, with_utls): без with_utls не стартуют REALITY и
// профили с fp= (T-02).
func pickRunner() inst.Runner { return inst.NewSingBoxRunner() }
