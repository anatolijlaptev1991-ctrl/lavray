// SPDX-License-Identifier: GPL-3.0-only

// rootembed.go — корень доверия обновлений этой сборки и адреса источников.
// В репозитории лежит заглушка root.json («корня ещё нет»): тогда ядро честно
// отвечает на CheckUpdates «обновления не настроены» (причина not_configured),
// а не «обновлений нет». Настоящий корень владелец получает на церемонии
// ключей и подставляет либо файлом root.json (go:embed), либо флагом
// компоновщика, который сильнее файла:
//
//	go build -ldflags "-X main.rootJSONB64=$(base64 -w0 root.json)" ./cmd/lavray-core
//
// Адреса bootstrap-источников метаданных переопределяются так же:
// -X main.bootstrapURLs=https://a.example/meta,https://b.example/meta
package main

import (
	"bytes"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"runtime"
	"strings"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/api"
)

//go:embed root.json
var embeddedRoot []byte

var (
	// rootJSONB64 — base64 настоящего root.json (флаг компоновщика); пусто — берём файл.
	rootJSONB64 string
	// bootstrapURLs — адреса метаданных через запятую (флаг компоновщика); пусто — по умолчанию.
	bootstrapURLs string
)

// defaultBootstrapURLs — GitHub Pages и зеркало jsDelivr той же ветки gh-pages.
var defaultBootstrapURLs = []string{
	"https://anatolijlaptev1991-ctrl.github.io/lavray/meta",
	"https://cdn.jsdelivr.net/gh/anatolijlaptev1991-ctrl/lavray@gh-pages/meta",
}

// isPlaceholderRoot: пусто или JSON без подписанного документа («signed»).
func isPlaceholderRoot(raw []byte) bool {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return true
	}
	var doc map[string]json.RawMessage
	if json.Unmarshal(raw, &doc) != nil {
		return false // не JSON-объект: пусть NewTrust вернёт понятную ошибку
	}
	_, has := doc["signed"]
	return !has
}

// trustRootJSON — корень доверия сборки или nil, если его нет.
func trustRootJSON() []byte {
	raw := embeddedRoot
	if rootJSONB64 != "" {
		if dec, err := base64.StdEncoding.DecodeString(strings.TrimSpace(rootJSONB64)); err == nil {
			raw = dec
		}
	}
	if isPlaceholderRoot(raw) {
		return nil
	}
	return raw
}

func bootstrapList() []string {
	if bootstrapURLs == "" {
		return defaultBootstrapURLs
	}
	var out []string
	for _, u := range strings.Split(bootstrapURLs, ",") {
		if u = strings.TrimSpace(u); u != "" {
			out = append(out, u)
		}
	}
	return out
}

// updaterConf — конфигурация обновлений для api.Deps. Версия приложения берётся
// из internal/version (флаг компоновщика), поэтому AppVersion не задаётся.
func updaterConf() *api.UpdaterConf {
	return &api.UpdaterConf{
		RootJSON:          trustRootJSON(),
		Product:           "lavray-" + runtime.GOOS,
		BootstrapMetadata: bootstrapList(),
	}
}
