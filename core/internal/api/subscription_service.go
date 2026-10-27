// subscription_service.go — SubscriptionService (W6+, аудит №7 F1): реальное
// обновление подписки через subs.Subscriber — fetch → parse → diff →
// подтверждение при деструктивном изменении → apply с автооткатом. Стрим
// отдаёт фазы прогресса; Rollback возвращает снапшот.
package api

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/subs"
)

// subscriberFor — Subscriber с настройками из settings (UA/HWID/лимиты).
func (s *Server) subscriberFor() *subs.Subscriber {
	opts := subs.Options{
		MaxBodyBytes:    64 << 20,
		AllowPrivateURL: s.settingBool("sub.allow_private_urls"),
		InsecureTLS:     s.settingBool("sub.insecure"),
		HWIDEnabled:     s.settingBool("sub.hwid_enabled"),
		Log: func(format string, args ...any) {
			s.logs.Logf("warn", "subs", format, args...)
		},
	}
	if ua := s.settingStr("sub.user_agent"); ua != "" {
		opts.UserAgent = ua
	}
	return subs.NewSubscriber(s.http, opts)
}

func (s *Server) UpdateSubscriptionSettings(ctx context.Context, req *connect.Request[lavrayv1.UpdateSubscriptionSettingsRequest]) (*connect.Response[lavrayv1.Group], error) {
	msg := req.Msg
	g, err := s.st.GetGroup(msg.GroupId)
	if err != nil {
		return nil, mapErr(err)
	}
	if msg.Url != nil {
		g.SubscriptionURL = *msg.Url
	}
	if err := s.st.UpdateGroup(g); err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(groupToProto(g)), nil
}

func (s *Server) DeleteSubscription(ctx context.Context, req *connect.Request[lavrayv1.DeleteSubscriptionRequest]) (*connect.Response[lavrayv1.Empty], error) {
	if err := s.st.DeleteGroup(req.Msg.GroupId); err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(&lavrayv1.Empty{}), nil
}

// UpdateSubscription — стрим прогресса обновления одной подписки.
func (s *Server) UpdateSubscription(ctx context.Context, req *connect.Request[lavrayv1.UpdateSubscriptionRequest], stream *connect.ServerStream[lavrayv1.SubscriptionProgress]) error {
	ctx = context.WithValue(ctx, confirmCtxKey{}, req.Header().Get("X-LAVRay-Confirm"))
	return s.updateOne(ctx, req.Msg.GroupId, stream, true)
}

// UpdateAllSubscriptions — все неархивные подписки без skip_auto_update.
func (s *Server) UpdateAllSubscriptions(ctx context.Context, req *connect.Request[lavrayv1.UpdateAllSubscriptionsRequest], stream *connect.ServerStream[lavrayv1.SubscriptionProgress]) error {
	groups, err := s.st.ListGroups()
	if err != nil {
		return mapErr(err)
	}
	for _, g := range groups {
		if g.Kind != model.GroupSubscription || g.Archive || g.SkipAutoUpdate {
			continue
		}
		if err := s.updateOne(ctx, g.ID, stream, false); err != nil {
			// одна упавшая подписка не останавливает остальные
			if ctx.Err() != nil {
				return ctx.Err()
			}
		}
	}
	return nil
}

func (s *Server) updateOne(ctx context.Context, groupID int64, stream *connect.ServerStream[lavrayv1.SubscriptionProgress], emit bool) error {
	send := func(phase lavrayv1.SubscriptionProgress_Phase, detail string) {
		if !emit && phase != lavrayv1.SubscriptionProgress_PHASE_FAILED {
			return
		}
		_ = stream.Send(&lavrayv1.SubscriptionProgress{
			GroupId: groupID,
			TsMs:    time.Now().UnixMilli(),
			Phase:   phase,
			Detail:  strpIf(detail),
		})
	}

	// Защита от параллельного обновления одной подписки (иначе два apply
	// гоняют одни и те же профили).
	s.subsMu.Lock()
	if s.subsRunning == nil {
		s.subsRunning = map[int64]bool{}
	}
	if s.subsRunning[groupID] {
		s.subsMu.Unlock()
		send(lavrayv1.SubscriptionProgress_PHASE_FAILED, "обновление уже идёт")
		return connect.NewError(connect.CodeAlreadyExists, errors.New("обновление подписки уже выполняется"))
	}
	s.subsRunning[groupID] = true
	s.subsMu.Unlock()
	defer func() {
		s.subsMu.Lock()
		delete(s.subsRunning, groupID)
		s.subsMu.Unlock()
	}()

	g, err := s.st.GetGroup(groupID)
	if err != nil {
		send(lavrayv1.SubscriptionProgress_PHASE_FAILED, err.Error())
		return mapErr(err)
	}
	send(lavrayv1.SubscriptionProgress_PHASE_REQUESTING, g.SubscriptionURL)

	sub := s.subscriberFor()
	var res *subs.UpdateResult
	var confirmErr *subs.ConfirmRequiredError
	for attempt := 0; attempt < 2; attempt++ {
		res, err = sub.Update(ctx, s.st, g, attempt > 0)
		if err == nil {
			break
		}
		if errors.As(err, &confirmErr) {
			// Деструктивное изменение: сообщаем UI и, если клиент прислал
			// confirm=true в исходном запросе — повторяем с подтверждением.
			send(lavrayv1.SubscriptionProgress_PHASE_FAILED, confirmErr.Error())
			if !subscriptionConfirmed(ctx) {
				return connect.NewError(connect.CodeFailedPrecondition, err)
			}
			continue
		}
		send(lavrayv1.SubscriptionProgress_PHASE_FAILED, err.Error())
		return mapErr(err)
	}
	if err != nil {
		return mapErr(err)
	}
	if res != nil {
		s.subsMu.Lock()
		if s.subsSnap == nil {
			s.subsSnap = map[int64]*subs.Snapshot{}
		}
		if snap, snapErr := subs.TakeSnapshot(s.st, groupID); snapErr == nil {
			s.subsSnap[groupID] = snap
		}
		s.subsMu.Unlock()
		send(lavrayv1.SubscriptionProgress_PHASE_PARSING, "")
		send(lavrayv1.SubscriptionProgress_PHASE_SAVING, "")
	}
	send(lavrayv1.SubscriptionProgress_PHASE_DONE, "")
	return nil
}

// subscriptionConfirmed — подтверждение деструктивного обновления
// (FR-UI-258). Для стрима читаем заголовок Connect-запроса
// X-LAVRay-Confirm: 1/true (в теле UpdateSubscriptionRequest поля нет).
func subscriptionConfirmed(ctx context.Context) bool {
	// connect.Request.Header() доступен только в хендлере; здесь —
	// через переданный контекст-значение (кладётся в updateOne).
	if v, ok := ctx.Value(confirmCtxKey{}).(string); ok {
		return v == "1" || v == "true"
	}
	return false
}

type confirmCtxKey struct{}

// RollbackSubscription — откат последнего успешного обновления к снапшоту.
func (s *Server) RollbackSubscription(ctx context.Context, req *connect.Request[lavrayv1.RollbackSubscriptionRequest]) (*connect.Response[lavrayv1.RollbackSubscriptionResponse], error) {
	s.subsMu.Lock()
	snap := s.subsSnap[req.Msg.GroupId]
	s.subsMu.Unlock()
	if snap == nil {
		return nil, failedPrecondition("нет снапшота для отката этой подписки")
	}
	if err := subs.Rollback(s.st, snap); err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(&lavrayv1.RollbackSubscriptionResponse{}), nil
}
