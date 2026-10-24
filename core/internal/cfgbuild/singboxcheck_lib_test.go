//go:build singbox_check

package cfgbuild

// singboxcheck_test.go — «sing-box check» для golden-конфигов (TEST-PLAN
// набор 2 / §3.2): конфиг парсится опциями форка и поднимается box.New
// (эквивалент cmd/sing-box check + libbox.CheckConfig), без запуска
// инстанса: box.New сразу закрывается.
//
// Без тега with_quic (дефолтный go test) протоколы на QUIC (hysteria2/tuic)
// не скомпилированы в реестр — box.New возвращает «... is not included in
// this build»; такие конфиги считаются валидными на уровне парсера
// (ErrFeatureTagMissing), полная проверка — `go test -tags with_quic`.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	box "github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/include"
	"github.com/sagernet/sing-box/option"
	"github.com/sagernet/sing/service"
)

// ErrFeatureTagMissing — outbound требует сборочного тега (например
// with_quic для hysteria2/tuic): конфиг распарсен, полная инициализация
// требует `go test -tags with_quic`.
var ErrFeatureTagMissing = errors.New("cfgbuild: sing-box build tag missing for a protocol in this config")

// singBoxCheck — parse (option.Options + UnmarshallExcluded через реестры
// форка) + box.New + Close. Порядок — как cmd/sing-box check.
func singBoxCheck(configJSON string) error {
	ctx := service.ContextWithDefaultRegistry(context.Background())
	ctx = box.Context(ctx,
		include.InboundRegistry(),
		include.OutboundRegistry(),
		include.EndpointRegistry(),
		include.DNSTransportRegistry(),
		include.ServiceRegistry(),
		include.CertificateProviderRegistry(),
	)

	var options option.Options
	if err := options.UnmarshalJSONContext(ctx, []byte(configJSON)); err != nil {
		return fmt.Errorf("parse: %w", err)
	}

	ctxRun, cancel := context.WithCancel(service.ExtendContext(ctx))
	defer cancel()
	instance, err := box.New(box.Options{Context: ctxRun, Options: options})
	if err == nil {
		instance.Close()
		return nil
	}
	if strings.Contains(err.Error(), "is not included in this build") {
		return ErrFeatureTagMissing
	}
	return err
}

// TestGoldenSingBoxCheck — каждый golden-эталон валиден для sing-box 1.14
// (парсинг опций форка + box.New). QUIC-протоколы без тега with_quic →
// ErrFeatureTagMissing (полная проверка: go test -tags with_quic).
func TestGoldenSingBoxCheck(t *testing.T) {
	for _, inPath := range loadGolden(t) {
		name := filepath.Base(inPath)
		t.Run(name, func(t *testing.T) {
			wantPath := filepath.Join("testdata", "golden", name[:len(name)-len(".in.json")]+".want.json")
			raw, err := os.ReadFile(wantPath)
			if err != nil {
				t.Fatalf("эталон не найден: %v", err)
			}
			if err := singBoxCheck(string(raw)); err != nil {
				if errors.Is(err, ErrFeatureTagMissing) {
					t.Logf("%s: ok (parse; полная проверка — -tags with_quic)", name)
					return
				}
				t.Fatalf("sing-box check: %v", err)
			}
		})
	}
}
