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
	return s.subscriberWith(subRequest{})
}

// subRequest — разовые переопределения из UpdateSubscriptionRequest (A16
// аудита round 1: поля use_proxy/insecure_tls/user_agent/clear_before/
// allow_private_urls/таймауты раньше игнорировались).
type subRequest struct {
	userAgent          string
	useProxy           *bool
	insecureTLS        *bool
	allowPrivate       *bool
	connectTimeout     time.Duration
	overallTimeout     time.Duration
	confirmDestructive bool
}

func (s *Server) subscriberWith(r subRequest) *subs.Subscriber {
	opts := subs.Options{
		MaxBodyBytes:    64 << 20,
		AllowPrivateURL: s.settingBool("sub.allow_private_urls"),
		InsecureTLS:     s.settingBool("sub.insecure"),
		HWIDEnabled:     s.settingBool("sub.hwid_enabled"),
		Log: func(format string, args ...any) {
			s.logs.Logf("warn", "subs", format, args...)
		},
	}
	if r.allowPrivate != nil {
		opts.AllowPrivateURL = *r.allowPrivate
	}
	if r.insecureTLS != nil {
		opts.InsecureTLS = *r.insecureTLS
	}
	if r.connectTimeout > 0 {
		opts.ConnectTimeout = r.connectTimeout
	}
	if r.overallTimeout > 0 {
		opts.OverallTimeout = r.overallTimeout
	}
	if ua := r.userAgent; ua != "" {
		opts.UserAgent = ua
	} else if ua := s.settingStr("sub.user_agent"); ua != "" {
		opts.UserAgent = ua
	}
	// T-16: через туннель, когда он поднят и use_proxy включён (LNB-33).
	return subs.NewSubscriber(s.httpForSubscriptions(r.useProxy), opts)
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
	// T-12: подписка — это группа; активный профиль удалять нельзя.
	if err := s.guardActiveGroup(req.Msg.GroupId); err != nil {
		return nil, err
	}
	if err := s.st.DeleteGroup(req.Msg.GroupId); err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(&lavrayv1.Empty{}), nil
}

// UpdateSubscription — стрим прогресса обновления одной подписки.
func (s *Server) UpdateSubscription(ctx context.Context, req *connect.Request[lavrayv1.UpdateSubscriptionRequest], stream *connect.ServerStream[lavrayv1.SubscriptionProgress]) error {
	ctx = context.WithValue(ctx, confirmCtxKey{}, req.Header().Get("X-LAVRay-Confirm"))
	m := req.Msg
	r := subRequest{
		userAgent:          m.GetUserAgent(),
		useProxy:           m.UseProxy,
		insecureTLS:        m.InsecureTls,
		allowPrivate:       m.AllowPrivateUrls,
		confirmDestructive: m.GetConfirmDestructive(),
	}
	if m.ConnectTimeoutMs != nil && m.GetConnectTimeoutMs() > 0 {
		r.connectTimeout = time.Duration(m.GetConnectTimeoutMs()) * time.Millisecond
	}
	if m.OverallTimeoutMs != nil && m.GetOverallTimeoutMs() > 0 {
		r.overallTimeout = time.Duration(m.GetOverallTimeoutMs()) * time.Millisecond
	}
	return s.updateOne(ctx, m.GroupId, stream, true, r)
}

// UpdateAllSubscriptions — все неархивные подписки без skip_auto_update.
func (s *Server) UpdateAllSubscriptions(ctx context.Context, req *connect.Request[lavrayv1.UpdateAllSubscriptionsRequest], stream *connect.ServerStream[lavrayv1.SubscriptionProgress]) error {
	groups, err := s.st.ListGroups()
	if err != nil {
		return mapErr(err)
	}
	for _, g := range groups {
		if g.Kind != model.GroupSubscription {
			continue
		}
		if g.Archive || g.SkipAutoUpdate {
			// FR-UI-108: пропуск виден в стриме, а не молча.
			_ = stream.Send(&lavrayv1.SubscriptionProgress{
				GroupId: g.ID,
				TsMs:    time.Now().UnixMilli(),
				Phase:   lavrayv1.SubscriptionProgress_PHASE_SKIPPED,
				Detail:  strpIf(skipReason(g)),
			})
			continue
		}
		if err := s.updateOne(ctx, g.ID, stream, false, subRequest{}); err != nil {
			// одна упавшая подписка не останавливает остальные
			if ctx.Err() != nil {
				return ctx.Err()
			}
		}
	}
	return nil
}

func skipReason(g *model.Group) string {
	if g.Archive {
		return "группа в архиве"
	}
	return "skip_auto_update"
}

func (s *Server) updateOne(ctx context.Context, groupID int64, stream *connect.ServerStream[lavrayv1.SubscriptionProgress], emit bool, r subRequest) error {
	// B2 (аудит round 2): ошибка отправки прекращает работу. Раньше после
	// отключения клиента fetch+Apply всё равно выполнялись до конца.
	var sendErr error
	send := func(p *lavrayv1.SubscriptionProgress) {
		if sendErr != nil {
			return
		}
		if !emit && p.Phase != lavrayv1.SubscriptionProgress_PHASE_FAILED {
			return
		}
		p.GroupId = groupID
		p.TsMs = time.Now().UnixMilli()
		if err := stream.Send(p); err != nil {
			sendErr = err
		}
	}
	sendPhase := func(phase lavrayv1.SubscriptionProgress_Phase, detail string) {
		send(&lavrayv1.SubscriptionProgress{Phase: phase, Detail: strpIf(detail)})
	}
	defer func() { _ = sendErr }()

	// Защита от параллельного обновления одной подписки (иначе два apply
	// гоняют одни и те же профили).
	s.subsMu.Lock()
	if s.subsRunning == nil {
		s.subsRunning = map[int64]bool{}
	}
	if s.subsRunning[groupID] {
		s.subsMu.Unlock()
		sendPhase(lavrayv1.SubscriptionProgress_PHASE_FAILED, "обновление уже идёт")
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
		sendPhase(lavrayv1.SubscriptionProgress_PHASE_FAILED, err.Error())
		return mapErr(err)
	}
	send(&lavrayv1.SubscriptionProgress{
		Phase:  lavrayv1.SubscriptionProgress_PHASE_STARTED,
		Detail: strpIf(g.Name),
	})
	sendPhase(lavrayv1.SubscriptionProgress_PHASE_REQUESTING, g.SubscriptionURL)

	sub := s.subscriberWith(r)
	var res *subs.UpdateResult
	var confirmErr *subs.ConfirmRequiredError
	for attempt := 0; attempt < 2; attempt++ {
		res, err = sub.Update(ctx, s.st, g, attempt > 0)
		if err == nil {
			break
		}
		if errors.As(err, &confirmErr) {
			// Деструктивное изменение (A15 аудита round 1): раньше уходил
			// PHASE_FAILED, и UI не мог показать «удалить N из M?». Теперь —
			// PHASE_CONFIRM_REQUIRED с числами; продолжаем только по явному
			// confirm_destructive (заголовок или поле запроса).
			diff := confirmErr.Diff
			resp := &lavrayv1.SubscriptionProgress{
				Phase:  lavrayv1.SubscriptionProgress_PHASE_CONFIRM_REQUIRED,
				Detail: strpIf(confirmErr.Reason),
			}
			if diff != nil {
				resp.WouldRemoveCount = int32p(int32(len(diff.Deleted)))
				resp.AddedCount = int32p(int32(len(diff.Added)))
				resp.RemovedCount = int32p(int32(len(diff.Deleted)))
				resp.TotalCount = int32p(int32(diff.Kept + diff.Updated + len(diff.Added)))
			}
			send(resp)
			if !(r.confirmDestructive || subscriptionConfirmed(ctx)) {
				// T-18: кадр CONFIRM_REQUIRED — штатный ответ «нужно решение
				// пользователя», а не сбой. Поток закрывается без ошибки:
				// клиент читает кадры циклом, и ошибка в конце потока делала
				// ветку подтверждения недостижимой. Группа не менялась;
				// продолжить можно повторным вызовом с confirm_destructive=true.
				return nil
			}
			continue
		}
		sendPhase(lavrayv1.SubscriptionProgress_PHASE_FAILED, err.Error())
		return mapErr(err)
	}
	if err != nil {
		return mapErr(err)
	}
	if res != nil {
		// A15 (аудит round 1): снапшот «до» берётся внутри Apply и
		// возвращается в UpdateResult — раньше API снимал снимок ПОСЛЕ
		// применения, и «Откатить подписку» не откатывал ничего.
		if res.Snapshot != nil {
			s.subsMu.Lock()
			if s.subsSnap == nil {
				s.subsSnap = map[int64]*subs.Snapshot{}
			}
			s.subsSnap[groupID] = res.Snapshot
			s.subsMu.Unlock()
		}
		send(&lavrayv1.SubscriptionProgress{
			Phase:        lavrayv1.SubscriptionProgress_PHASE_DIFFING,
			AddedCount:   int32p(int32(len(res.Diff.Added))),
			RemovedCount: int32p(int32(len(res.Diff.Deleted))),
			TotalCount:   int32p(int32(res.Diff.Kept + res.Diff.Updated + len(res.Diff.Added))),
		})
		sendPhase(lavrayv1.SubscriptionProgress_PHASE_SAVING, "")
		if res.Info != nil {
			send(&lavrayv1.SubscriptionProgress{
				Phase:    lavrayv1.SubscriptionProgress_PHASE_DONE,
				UserInfo: subscriptionInfoToProto(res.Info),
			})
			return nil
		}
	}
	sendPhase(lavrayv1.SubscriptionProgress_PHASE_DONE, "")
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
	// B1 (аудит round 2): откат идёт под тем же per-group флагом, что и
	// обновление, — иначе apply и rollback удаляют профили друг у друга.
	s.subsMu.Lock()
	if s.subsRunning == nil {
		s.subsRunning = map[int64]bool{}
	}
	if s.subsRunning[req.Msg.GroupId] {
		s.subsMu.Unlock()
		return nil, failedPrecondition("обновление этой подписки ещё идёт — откат невозможен")
	}
	snap := s.subsSnap[req.Msg.GroupId]
	if snap == nil {
		s.subsMu.Unlock()
		return nil, failedPrecondition("нет снапшота для отката этой подписки")
	}
	s.subsRunning[req.Msg.GroupId] = true
	s.subsMu.Unlock()
	defer func() {
		s.subsMu.Lock()
		delete(s.subsRunning, req.Msg.GroupId)
		s.subsMu.Unlock()
	}()

	if err := subs.Rollback(s.st, snap); err != nil {
		return nil, mapErr(err)
	}
	// Снапшот израсходован: повторный откат к тому же состоянию бессмыслен
	// и воскрешал бы давно устаревший набор.
	s.subsMu.Lock()
	delete(s.subsSnap, req.Msg.GroupId)
	s.subsMu.Unlock()
	return connect.NewResponse(&lavrayv1.RollbackSubscriptionResponse{}), nil
}
