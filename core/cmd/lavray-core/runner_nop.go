// SPDX-License-Identifier: GPL-3.0-only

//go:build !singbox_run

package main

import "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/inst"

// pickRunner — сборка БЕЗ тега singbox_run: честная заглушка (Connect вернёт
// «sing-box не встроен»). Релизные сборки обязаны идти с -tags singbox_run.
func pickRunner() inst.Runner { return inst.NopRunner{} }
