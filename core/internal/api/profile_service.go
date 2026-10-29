// SPDX-License-Identifier: GPL-3.0-only

// profile_service.go — ProfileService (W6): CRUD, метаданные, перемещение,
// клонирование, порядок, экспорт ссылок и двухфазный импорт контента
// (FR-UI-116/190/191/257, LNB-25). Остальные RPC сервиса — unimplemented.go.
package api

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/links"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/subs/happ"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/subs/parser"
)

func (s *Server) ListProfiles(ctx context.Context, req *connect.Request[lavrayv1.ListProfilesRequest]) (*connect.Response[lavrayv1.ListProfilesResponse], error) {
	msg := req.Msg
	groupID := int64(-1) // все группы
	if msg.GroupId != nil {
		groupID = *msg.GroupId
	}
	list, err := s.st.ListProfiles(groupID)
	if err != nil {
		return nil, mapErr(err)
	}
	search := ""
	if msg.Search != nil {
		search = strings.ToLower(*msg.Search)
	}
	favOnly := optBool(msg.FavoritesOnly)
	tags := msg.TagsAnyOf

	out := make([]*lavrayv1.Profile, 0, len(list))
	total := int64(0)
	for _, p := range list {
		if search != "" &&
			!strings.Contains(strings.ToLower(p.Name), search) &&
			!strings.Contains(strings.ToLower(p.Address), search) &&
			!strings.Contains(strings.ToLower(string(p.Type)), search) {
			continue
		}
		if favOnly && !p.Favorite {
			continue
		}
		if len(tags) > 0 && !hasAnyTag(p.Tags, tags) {
			continue
		}
		total++
		out = append(out, profileToProto(p))
	}
	offset, limit := pageOf(msg.Page, total)
	if offset > int64(len(out)) {
		offset = int64(len(out))
	}
	end := int64(len(out))
	if limit >= 0 && offset+limit < end {
		end = offset + limit
	}
	out = out[offset:end]
	return connect.NewResponse(&lavrayv1.ListProfilesResponse{Profiles: out, Total: total}), nil
}

func hasAnyTag(have, want []string) bool {
	set := map[string]bool{}
	for _, t := range have {
		set[t] = true
	}
	for _, t := range want {
		if set[t] {
			return true
		}
	}
	return false
}

func pageOf(p *lavrayv1.Page, total int64) (offset, limit int64) {
	if p == nil {
		return 0, -1 // без пагинации
	}
	offset = p.Offset
	if offset < 0 {
		offset = 0
	}
	limit = int64(p.Limit)
	// A10 (аудит №4): контракт Page.limit = «0 → 100»; пустой список на
	// limit=0 ломал первых клиентов (они передают дефолт 0).
	if limit == 0 {
		limit = 100
	}
	if limit < 0 {
		limit = -1
	}
	return offset, limit
}

func (s *Server) GetProfile(ctx context.Context, req *connect.Request[lavrayv1.GetProfileRequest]) (*connect.Response[lavrayv1.Profile], error) {
	p, err := s.st.GetProfile(req.Msg.Id)
	if err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(profileToProto(p)), nil
}

func (s *Server) CreateProfile(ctx context.Context, req *connect.Request[lavrayv1.CreateProfileRequest]) (*connect.Response[lavrayv1.Profile], error) {
	in := req.Msg.Profile
	if in == nil {
		return nil, invalidArg("profile обязателен")
	}
	if in.GroupId <= 0 {
		return nil, invalidArg("group_id обязателен при создании профиля")
	}
	m, err := profileToModel(in)
	if err != nil {
		return nil, mapErr(err)
	}
	m.ID = 0 // назначает хранилище
	// T-51: сервер, добавленный вручную в группу-подписку, обновление не удалит.
	m.Manual = s.isSubscriptionGroup(m.GroupID)
	if err := s.st.CreateProfile(m); err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(profileToProto(m)), nil
}

func (s *Server) UpdateProfile(ctx context.Context, req *connect.Request[lavrayv1.UpdateProfileRequest]) (*connect.Response[lavrayv1.UpdateProfileResponse], error) {
	in := req.Msg.Profile
	if in == nil || in.Id <= 0 {
		return nil, invalidArg("profile.id обязателен при обновлении")
	}
	old, err := s.st.GetProfile(in.Id)
	if err != nil {
		return nil, mapErr(err)
	}
	m, err := profileToModel(in)
	if err != nil {
		return nil, mapErr(err)
	}
	// Статистика и результаты тестов — серверные, клиент их перезаписать не может.
	m.Traffic = old.Traffic
	m.TestResult = old.TestResult
	// T-51: флаг «добавлен вручную» тоже серверный; перенос профиля в
	// группу-подписку делает его ручным.
	m.Manual = old.Manual || (m.GroupID != old.GroupID && s.isSubscriptionGroup(m.GroupID))
	if err := s.st.UpdateProfile(m); err != nil {
		return nil, mapErr(err)
	}
	stRun := s.inst.Status().Run                        // nil = idle
	restart := stRun != nil && stRun.ProfileID == in.Id // FR-UI-062/088
	return connect.NewResponse(&lavrayv1.UpdateProfileResponse{
		Profile:             profileToProto(m),
		NeedsProfileRestart: restart,
	}), nil
}

func (s *Server) DeleteProfile(ctx context.Context, req *connect.Request[lavrayv1.DeleteProfileRequest]) (*connect.Response[lavrayv1.Empty], error) {
	if len(req.Msg.Ids) == 0 {
		return nil, invalidArg("ids не заданы")
	}
	// A9 (аудит round 1): профиль активного соединения удалять нельзя —
	// иначе Restart/RestartProfile падают с NotFound, а инстанс остаётся
	// с «висящей» ссылкой на профиль. Сначала Disconnect.
	if run := s.inst.Status().Run; run != nil && run.ProfileID != 0 {
		for _, id := range req.Msg.Ids {
			if id == run.ProfileID {
				return nil, failedPrecondition(
					"профиль %d активен — сначала отключитесь или переключитесь на другой", id)
			}
		}
	}
	for _, id := range req.Msg.Ids {
		if err := s.st.DeleteProfile(id); err != nil {
			return nil, mapErr(err)
		}
	}
	return connect.NewResponse(&lavrayv1.Empty{}), nil
}

func (s *Server) SetProfileMeta(ctx context.Context, req *connect.Request[lavrayv1.SetProfileMetaRequest]) (*connect.Response[lavrayv1.Profile], error) {
	msg := req.Msg
	p, err := s.st.GetProfile(msg.Id)
	if err != nil {
		return nil, mapErr(err)
	}
	if msg.Favorite != nil {
		p.Favorite = *msg.Favorite
	}
	if msg.Tags != nil {
		p.Tags = msg.Tags // замещающе
	}
	if msg.Notes != nil {
		p.Notes = *msg.Notes
	}
	if err := s.st.UpdateProfile(p); err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(profileToProto(p)), nil
}

func (s *Server) MoveProfiles(ctx context.Context, req *connect.Request[lavrayv1.MoveProfilesRequest]) (*connect.Response[lavrayv1.Empty], error) {
	msg := req.Msg
	if _, err := s.st.GetGroup(msg.TargetGroupId); err != nil {
		return nil, mapErr(err)
	}
	toSubscription := s.isSubscriptionGroup(msg.TargetGroupId) // T-51
	for _, id := range msg.Ids {
		p, err := s.st.GetProfile(id)
		if err != nil {
			return nil, mapErr(err)
		}
		p.GroupID = msg.TargetGroupId
		if toSubscription {
			p.Manual = true // перенесён вручную: обновление подписки не удалит
		}
		if err := s.st.UpdateProfile(p); err != nil {
			return nil, mapErr(err)
		}
	}
	return connect.NewResponse(&lavrayv1.Empty{}), nil
}

func (s *Server) CloneProfiles(ctx context.Context, req *connect.Request[lavrayv1.CloneProfilesRequest]) (*connect.Response[lavrayv1.CloneProfilesResponse], error) {
	var cloned []int64
	for _, id := range req.Msg.Ids {
		p, err := s.st.GetProfile(id)
		if err != nil {
			return nil, mapErr(err)
		}
		origID := p.ID
		p.ID = 0
		p.Name = fmt.Sprintf("%s (копия)", p.Name)
		if err := s.st.CreateProfile(p); err != nil {
			return nil, mapErr(err)
		}
		cloned = append(cloned, p.ID)
		_ = origID
	}
	return connect.NewResponse(&lavrayv1.CloneProfilesResponse{NewIds: cloned}), nil
}

func (s *Server) ReorderProfiles(ctx context.Context, req *connect.Request[lavrayv1.ReorderProfilesRequest]) (*connect.Response[lavrayv1.Empty], error) {
	msg := req.Msg
	// Самокоррекция: существующие в группе id, отсутствующие в ordered — в конец.
	existing, err := s.st.ListProfiles(msg.GroupId)
	if err != nil {
		return nil, mapErr(err)
	}
	seen := map[int64]bool{}
	ordered := make([]int64, 0, len(existing))
	for _, id := range msg.OrderedIds {
		for _, p := range existing {
			if p.ID == id && !seen[id] {
				seen[id] = true
				ordered = append(ordered, id)
			}
		}
	}
	for _, p := range existing {
		if !seen[p.ID] {
			ordered = append(ordered, p.ID)
		}
	}
	if err := s.st.ReorderProfiles(msg.GroupId, ordered); err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(&lavrayv1.Empty{}), nil
}

func (s *Server) ExportLinks(ctx context.Context, req *connect.Request[lavrayv1.ExportLinksRequest]) (*connect.Response[lavrayv1.ExportLinksResponse], error) {
	msg := req.Msg
	var list []*model.Profile
	if len(msg.Ids) > 0 {
		for _, id := range msg.Ids {
			p, err := s.st.GetProfile(id)
			if err != nil {
				return nil, mapErr(err)
			}
			list = append(list, p)
		}
	} else {
		// T-25: пустой запрос — все профили (как ListProfiles без group_id);
		// с group_id — только эта группа.
		groupID := int64(-1)
		if msg.GroupId != nil {
			groupID = *msg.GroupId
		}
		var err error
		list, err = s.st.ListProfiles(groupID)
		if err != nil {
			return nil, mapErr(err)
		}
	}
	var out []string
	for _, p := range list {
		var link string
		var err error
		switch msg.Format {
		case lavrayv1.ExportLinksRequest_FORMAT_NEKO:
			link, err = links.BuildNekoLink(p)
		case lavrayv1.ExportLinksRequest_FORMAT_VMESS_V2RAYN:
			link, err = links.BuildLinkWithOptions(p, links.Options{VMessURLFormat: false})
		default: // FORMAT_STANDARD
			link, err = links.BuildLink(p)
		}
		if err != nil {
			// Неэкспортируемые типы (custom/chain/naive) пропускаем, не роняя пакет.
			continue
		}
		out = append(out, link)
	}
	return connect.NewResponse(&lavrayv1.ExportLinksResponse{Links: out}), nil
}

// ImportContent — двухфазный безопасный импорт (FR-UI-257, LNB-25):
// preview_only=true — разобрать без сохранения (parsed-профили, id=0,
// warnings по custom-полям); иначе — сохранить в целевую группу (не задана
// или 0 — встроенная «Default», см. importTargetGroup) и вернуть
// added_profile_ids. Контент: ссылка/список/base64/sing-box JSON/happ://.
func (s *Server) ImportContent(ctx context.Context, req *connect.Request[lavrayv1.ImportContentRequest]) (*connect.Response[lavrayv1.ImportContentResponse], error) {
	msg := req.Msg
	if strings.TrimSpace(msg.Content) == "" {
		return nil, invalidArg("content пуст")
	}
	// T-19: ссылка на подписку (в том числе happ://crypt…, раскрывающийся в
	// неё) — не профиль. Ядро сообщает kind=SUBSCRIPTION_URL, ничего не
	// разбирает и не сохраняет; подписку создаёт клиент (CreateSubscription).
	// intent=AS_LINKS отключает определение: разобрать как share-ссылку.
	if msg.Intent != lavrayv1.ImportContentRequest_INTENT_AS_LINKS && isSubscriptionContent(msg.Content) {
		return connect.NewResponse(&lavrayv1.ImportContentResponse{
			Kind: lavrayv1.ImportContentResponse_CONTENT_KIND_SUBSCRIPTION_URL,
		}), nil
	}
	res, err := parser.Parse([]byte(msg.Content), parser.Options{
		// Расшифровка happ — в процессе (без подпроцесса, UX-15).
		DecryptHapp: happDecryptInProcess,
		MaxProfiles: 10000,
	})
	if err != nil {
		return nil, mapErr(err)
	}
	// Группировка по странам (FR-UI-008): ядро определяет ISO-код по имени
	// (флаг/код/название) или TLD — UI показывает ключи сгруппированными.
	for _, p := range res.Profiles {
		if p.Geo == "" {
			p.Geo = model.DetectGeo(p.Name, p.Address)
		}
	}
	parsed := make([]*lavrayv1.Profile, 0, len(res.Profiles))
	var warns []*lavrayv1.CustomFieldWarning
	for i, p := range res.Profiles {
		pp := profileToProto(p)
		pp.Id = 0 // preview: не сохранён
		parsed = append(parsed, pp)
		if len(res.Warnings) > 0 {
			warns = append(warns, &lavrayv1.CustomFieldWarning{
				ProfileIndex:  int32(i),
				DroppedFields: customFieldsDropped(p),
				Preview:       strpIf(strings.Join(res.Warnings, "; ")),
			})
		}
	}
	resp := &lavrayv1.ImportContentResponse{
		Kind:                contentKindOf(msg.Content, res.Format),
		ParsedProfiles:      parsed,
		CustomFieldWarnings: warns,
	}
	if optBool(msg.PreviewOnly) {
		return connect.NewResponse(resp), nil
	}
	groupID, err := s.importTargetGroup(msg.TargetGroupId)
	if err != nil {
		return nil, err
	}
	// T-51: одна транзакция, дубли (тот же сервер) пропускаются.
	added, skipped, err := s.commitImport(groupID, res.Profiles)
	if err != nil {
		return nil, mapErr(err)
	}
	resp.AddedProfileIds = added
	if skipped > 0 {
		resp.Log = append(resp.Log, fmt.Sprintf("пропущено уже имеющихся серверов: %d", skipped))
	}
	return connect.NewResponse(resp), nil
}

// importTargetGroup выбирает группу для сохранения импорта (T-07). Диалог
// импорта из «Подключения», меню титлбара и онбординга не знает группу и не
// передаёт target_group_id (или передаёт 0) — тогда профили идут во
// встроенную «Default» (store.DefaultGroupID). Если пользователь её удалил,
// берётся первая обычная (не подписочная) группа в порядке вкладок. Явный
// положительный id обязан существовать; отрицательный — ошибка клиента.
func (s *Server) importTargetGroup(requested *int64) (int64, error) {
	if requested != nil && *requested < 0 {
		return 0, invalidArg("target_group_id не может быть отрицательным")
	}
	if requested != nil && *requested > 0 {
		if _, err := s.st.GetGroup(*requested); err != nil {
			return 0, mapErr(err)
		}
		return *requested, nil
	}
	_, err := s.st.GetGroup(store.DefaultGroupID)
	if err == nil {
		return store.DefaultGroupID, nil
	}
	if !errors.Is(err, store.ErrNotFound) {
		return 0, mapErr(err)
	}
	groups, err := s.st.ListGroups()
	if err != nil {
		return 0, mapErr(err)
	}
	for _, g := range groups {
		if g.Kind == model.GroupBasic {
			return g.ID, nil
		}
	}
	return 0, failedPrecondition("нет группы для импорта: создайте обычную группу")
}

// happDecryptInProcess — расшифровка happ:// внутри процесса (UX-15),
// LNB-13: битые входы дают ошибку, не панику.
func happDecryptInProcess(link string) (string, error) {
	if !happ.IsHappLink(link) {
		return "", nil // не happ — парсер разберёт как обычную ссылку
	}
	return happ.Decrypt(link)
}

// customFieldsDropped — какие custom-поля были обнулены при импорте (LNB-25).
func customFieldsDropped(p *model.Profile) []string {
	var out []string
	if p.CustomConfigJSON != "" || p.CustomOutboundJSON != "" {
		out = append(out, "custom_config", "custom_outbound")
	}
	if d, ok := p.Detail.(*model.CustomDetail); ok && (len(d.Command) > 0 || d.Core != "") {
		out = append(out, "custom_core", "custom_command")
	}
	return out
}
