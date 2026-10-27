// group_service.go — GroupService (аудит №4 A2): список/создание/правка/
// удаление/порядок групп. Без ListGroups UI не мог узнать id встроенной
// группы и слал импорт в несуществующую group_id=1.
package api

import (
	"context"

	"connectrpc.com/connect"
	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
)

func (s *Server) ListGroups(ctx context.Context, req *connect.Request[lavrayv1.ListGroupsRequest]) (*connect.Response[lavrayv1.ListGroupsResponse], error) {
	list, err := s.st.ListGroups()
	if err != nil {
		return nil, mapErr(err)
	}
	out := &lavrayv1.ListGroupsResponse{}
	for _, g := range list {
		out.Groups = append(out.Groups, groupToProto(g))
	}
	return connect.NewResponse(out), nil
}

func (s *Server) CreateGroup(ctx context.Context, req *connect.Request[lavrayv1.CreateGroupRequest]) (*connect.Response[lavrayv1.Group], error) {
	in := req.Msg.Group
	if in == nil || in.Name == "" {
		return nil, invalidArg("group.name обязателен")
	}
	g := &model.Group{Name: in.Name, Kind: model.GroupBasic}
	if err := s.st.CreateGroup(g); err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(groupToProto(g)), nil
}

func (s *Server) UpdateGroup(ctx context.Context, req *connect.Request[lavrayv1.UpdateGroupRequest]) (*connect.Response[lavrayv1.Group], error) {
	in := req.Msg.Group
	if in == nil || in.Id == 0 {
		return nil, invalidArg("group.id обязателен")
	}
	g, err := s.st.GetGroup(in.Id)
	if err != nil {
		return nil, mapErr(err)
	}
	if in.Name != "" {
		g.Name = in.Name
	}
	g.Archive = in.Archive
	g.SkipAutoUpdate = in.SkipAutoUpdate
	if err := s.st.UpdateGroup(g); err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(groupToProto(g)), nil
}

func (s *Server) DeleteGroup(ctx context.Context, req *connect.Request[lavrayv1.DeleteGroupRequest]) (*connect.Response[lavrayv1.Empty], error) {
	if err := s.st.DeleteGroup(req.Msg.Id); err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(&lavrayv1.Empty{}), nil
}

func (s *Server) ReorderGroups(ctx context.Context, req *connect.Request[lavrayv1.ReorderGroupsRequest]) (*connect.Response[lavrayv1.Empty], error) {
	if err := s.st.ReorderGroups(req.Msg.OrderedIds); err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(&lavrayv1.Empty{}), nil
}
