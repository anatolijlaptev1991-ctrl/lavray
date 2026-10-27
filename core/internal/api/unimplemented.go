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

func (s *Server) ResetTraffic(ctx context.Context, req *connect.Request[lavrayv1.ResetTrafficRequest]) (*connect.Response[lavrayv1.Empty], error) {
	return nil, errNotYetW6
}

func (s *Server) RemoveUnavailableProfiles(ctx context.Context, req *connect.Request[lavrayv1.RemoveUnavailableProfilesRequest]) (*connect.Response[lavrayv1.RemoveUnavailableResponse], error) {
	return nil, errNotYetW6
}

func (s *Server) DeduplicateProfiles(ctx context.Context, req *connect.Request[lavrayv1.DeduplicateProfilesRequest]) (*connect.Response[lavrayv1.DeduplicateResponse], error) {
	return nil, errNotYetW6
}

func (s *Server) ExportConfig(ctx context.Context, req *connect.Request[lavrayv1.ExportConfigRequest]) (*connect.Response[lavrayv1.ExportConfigResponse], error) {
	return nil, errNotYetW6
}

func (s *Server) StopTests(ctx context.Context, req *connect.Request[lavrayv1.StopTestsRequest]) (*connect.Response[lavrayv1.Empty], error) {
	return nil, errNotYetW6
}

func (s *Server) ClearTestResults(ctx context.Context, req *connect.Request[lavrayv1.ClearTestResultsRequest]) (*connect.Response[lavrayv1.Empty], error) {
	return nil, errNotYetW6
}

func (s *Server) ResolveDomains(ctx context.Context, req *connect.Request[lavrayv1.ResolveDomainsRequest]) (*connect.Response[lavrayv1.ResolveDomainsResponse], error) {
	return nil, errNotYetW6
}

func (s *Server) TestLatency(ctx context.Context, req *connect.Request[lavrayv1.TestLatencyRequest], stream *connect.ServerStream[lavrayv1.LatencyResult]) error {
	return errNotYetW6
}

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
