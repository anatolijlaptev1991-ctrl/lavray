// SPDX-License-Identifier: GPL-3.0-only

// unimplemented.go — СГЕНЕРИРОВАННЫЕ заглушки RPC пяти W6-сервисов, не
// реализованных немедленно (полноценная реализация переносится сюда из
// этого файла по мере надобности; W7/W8-сервисы идут через встроенные
// connect Unimplemented*-хендлеры, см. server.go). Каждая заглушка
// возвращает connect.CodeUnimplemented. Генерация — по Handler-интерфейсам
// lavray.connect.go (receiver *Server, коллизий имён в этих пяти нет).
package api

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
)

var errNotYetW6 = connect.NewError(connect.CodeUnimplemented, errors.New("RPC запланирован, но ещё не реализован в W6"))

func (s *Server) CreatePreset(ctx context.Context, req *connect.Request[lavrayv1.CreatePresetRequest]) (*connect.Response[lavrayv1.RoutingPreset], error) {
	return nil, errNotYetW6
}

func (s *Server) UpdatePreset(ctx context.Context, req *connect.Request[lavrayv1.UpdatePresetRequest]) (*connect.Response[lavrayv1.UpdatePresetResponse], error) {
	return nil, errNotYetW6
}

func (s *Server) DeletePreset(ctx context.Context, req *connect.Request[lavrayv1.DeletePresetRequest]) (*connect.Response[lavrayv1.Empty], error) {
	return nil, errNotYetW6
}

func (s *Server) ResetBuiltinPreset(ctx context.Context, req *connect.Request[lavrayv1.ResetBuiltinPresetRequest]) (*connect.Response[lavrayv1.RoutingPreset], error) {
	return nil, errNotYetW6
}

func (s *Server) ImportNekoRayRoute(ctx context.Context, req *connect.Request[lavrayv1.ImportNekoRayRouteRequest]) (*connect.Response[lavrayv1.RoutingPreset], error) {
	return nil, errNotYetW6
}

func (s *Server) ResetSettings(ctx context.Context, req *connect.Request[lavrayv1.ResetSettingsRequest]) (*connect.Response[lavrayv1.SetSettingsResponse], error) {
	return nil, errNotYetW6
}

func (s *Server) SubscribeSettings(ctx context.Context, req *connect.Request[lavrayv1.SubscribeSettingsRequest], stream *connect.ServerStream[lavrayv1.SettingsChanged]) error {
	return errNotYetW6
}
