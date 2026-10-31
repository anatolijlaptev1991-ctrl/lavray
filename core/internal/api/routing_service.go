// SPDX-License-Identifier: GPL-3.0-only

// routing_service.go — RoutingService: список наборов (встроенные + пользовательские),
// чтение, активация. Правка пользовательских наборов — preset_service.go.
package api

import (
	"context"

	"connectrpc.com/connect"
	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/presets"
)

// presetProto — набор → proto с вычисленным source_updated.
func (s *Server) presetProto(p *presets.Preset) (*lavrayv1.RoutingPreset, error) {
	rev, err := builtinRevisions()
	if err != nil {
		return nil, err
	}
	return presetOut(p, rev), nil
}

// allPresets — встроенные наборы, затем пользовательские (порядок карточек в UI).
func (s *Server) allPresets() ([]*presets.Preset, error) {
	list, err := presets.BuiltinPresets()
	if err != nil {
		return nil, err
	}
	custom, err := s.presetRepo.List()
	if err != nil {
		return nil, err
	}
	return append(list, custom...), nil
}

func (s *Server) ListPresets(ctx context.Context, req *connect.Request[lavrayv1.ListPresetsRequest]) (*connect.Response[lavrayv1.ListPresetsResponse], error) {
	list, err := s.allPresets()
	if err != nil {
		return nil, mapErr(err)
	}
	rev, err := builtinRevisions()
	if err != nil {
		return nil, mapErr(err)
	}
	out := make([]*lavrayv1.RoutingPreset, 0, len(list))
	for _, p := range list {
		out = append(out, presetOut(p, rev))
	}
	return connect.NewResponse(&lavrayv1.ListPresetsResponse{Presets: out, ActivePresetId: s.activePresetID()}), nil
}

func (s *Server) GetPreset(ctx context.Context, req *connect.Request[lavrayv1.GetPresetRequest]) (*connect.Response[lavrayv1.RoutingPreset], error) {
	p, ok, err := s.findPreset(req.Msg.Id)
	if err != nil {
		return nil, mapErr(err)
	}
	if !ok {
		return nil, notFound("пресет %q", req.Msg.Id)
	}
	out, err := s.presetProto(p)
	if err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(out), nil
}

func (s *Server) ActivatePreset(ctx context.Context, req *connect.Request[lavrayv1.ActivatePresetRequest]) (*connect.Response[lavrayv1.ActivatePresetResponse], error) {
	p, ok, err := s.findPreset(req.Msg.Id)
	if err != nil {
		return nil, mapErr(err)
	}
	if !ok {
		return nil, notFound("пресет %q", req.Msg.Id)
	}
	if err := p.Validate(); err != nil {
		return nil, mapErr(err)
	}
	// F2 (аудит №7): активный пресет — в settings (единственный источник,
	// который читает activePresetID при сборке конфига), не в meta.
	if err := s.setActivePreset(p.ID); err != nil {
		return nil, mapErr(err)
	}
	needsRestart := s.inst.Status().State != instStateIdle
	return connect.NewResponse(&lavrayv1.ActivatePresetResponse{NeedsProfileRestart: needsRestart}), nil
}

func (s *Server) GetActivePreset(ctx context.Context, req *connect.Request[lavrayv1.GetActivePresetRequest]) (*connect.Response[lavrayv1.RoutingPreset], error) {
	active := s.activePresetID()
	p, ok, err := s.findPreset(active)
	if err != nil {
		return nil, mapErr(err)
	}
	if !ok {
		return nil, notFound("активный пресет %q", active)
	}
	out, err := s.presetProto(p)
	if err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(out), nil
}
