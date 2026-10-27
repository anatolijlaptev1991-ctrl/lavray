// test_service.go — TestLatency/StopTests/ClearTestResults/ResetTraffic
// (FR-UI-200…209, 211). TCP-пинг реальный: dial address:port с таймаутом и
// конкурентностью из запроса. URL/Full-режимы выносятся на уровень выше
// (нужен запущенный инстанс), здесь — честная проверка доступности сервера,
// результат сохраняется в профиль (TestResult) и отдаётся стримом.
package api

import (
	"context"
	"errors"
	"net"
	"strconv"
	"sync"
	"time"

	"connectrpc.com/connect"
	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
)

const (
	defaultTestTimeoutMs  = 10000
	defaultTestConcurrent = 10
)

// testRun — отмена текущего батча (StopTests, FR-UI-203).
type testRun struct {
	mu     sync.Mutex
	cancel context.CancelFunc
}

func (s *Server) testCancel() context.CancelFunc {
	s.testsMu.Lock()
	defer s.testsMu.Unlock()
	if s.testsRunning == nil {
		s.testsRunning = &testRun{}
	}
	return func() {
		s.testsMu.Lock()
		defer s.testsMu.Unlock()
		if s.testsRunning.cancel != nil {
			s.testsRunning.cancel()
		}
	}
}

func (s *Server) setTestCancel(cancel context.CancelFunc) {
	s.testsMu.Lock()
	defer s.testsMu.Unlock()
	if s.testsRunning == nil {
		s.testsRunning = &testRun{}
	}
	s.testsRunning.cancel = cancel
}

// TestLatency — стрим результатов по профилям (один кадр на профиль).
func (s *Server) TestLatency(ctx context.Context, req *connect.Request[lavrayv1.TestLatencyRequest], stream *connect.ServerStream[lavrayv1.LatencyResult]) error {
	msg := req.Msg
	if len(msg.ProfileIds) == 0 {
		return invalidArg("profile_ids не заданы")
	}
	if msg.Mode == lavrayv1.TestLatencyRequest_MODE_URL_TEST || msg.Mode == lavrayv1.TestLatencyRequest_MODE_FULL_TEST {
		return failedPrecondition(
			"URL/Full-тест требует запущенного инстанса (туннель); используйте TCP-пинг или подключитесь")
	}

	timeoutMs := int(msg.GetTimeoutMs())
	if timeoutMs <= 0 {
		timeoutMs = defaultTestTimeoutMs
	}
	concurrency := int(msg.GetConcurrency())
	if concurrency <= 0 {
		concurrency = defaultTestConcurrent
	}
	if concurrency > 64 {
		concurrency = 64
	}
	timeout := time.Duration(timeoutMs) * time.Millisecond

	// Профили читаем заранее: стрим не должен падать на середине из-за
	// удалённого во время теста профиля.
	type item struct {
		p *model.Profile
	}
	items := make([]item, 0, len(msg.ProfileIds))
	for _, id := range msg.ProfileIds {
		p, err := s.st.GetProfile(id)
		if err != nil {
			continue // удалённый профиль пропускаем, а не валим весь батч
		}
		items = append(items, item{p: p})
	}
	if len(items) == 0 {
		return invalidArg("ни одного профиля из списка не существует")
	}

	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	s.setTestCancel(cancel)
	defer s.setTestCancel(nil)

	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	var sendMu sync.Mutex
	var firstErr error
	done := 0
	total := len(items)

	for i, it := range items {
		if runCtx.Err() != nil {
			break
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int, p *model.Profile) {
			defer wg.Done()
			defer func() { <-sem }()

			res := s.tcpPing(runCtx, p, timeout)
			// Сохраняем результат (TestedAt/Latency/LastError) — только если
			// профиль ещё существует (иначе UpdateProfile вернёт NotFound).
			saved := *p
			saved.TestResult = res
			if err := s.st.UpdateProfile(&saved); err != nil && !errors.Is(err, store.ErrNotFound) {
				s.logs.Logf("warn", "test", "сохранение результата профиля %d: %v", p.ID, err)
			}

			sendMu.Lock()
			defer sendMu.Unlock()
			if firstErr != nil {
				return
			}
			done++
			if err := stream.Send(&lavrayv1.LatencyResult{
				ProfileId: p.ID,
				Result:    testResultToProto(res),
				Index:     int32(done),
				Total:     int32(total),
			}); err != nil {
				firstErr = err
				cancel()
			}
			_ = idx
		}(i, it.p)
	}
	wg.Wait()
	if firstErr != nil {
		return firstErr
	}
	if ctx.Err() != nil {
		return nil
	}
	return nil
}

// tcpPing измеряет время установки TCP-соединения с сервером профиля.
func (s *Server) tcpPing(ctx context.Context, p *model.Profile, timeout time.Duration) model.TestResult {
	now := time.Now().UnixMilli()
	if p == nil || p.Address == "" || p.Port <= 0 {
		return model.TestResult{TestedAtMs: &now, LastError: "нет адреса/порта"}
	}
	host := p.Address
	if ip := net.ParseIP(host); ip == nil && host == "" {
		return model.TestResult{TestedAtMs: &now, LastError: "пустой адрес"}
	}
	addr := net.JoinHostPort(host, strconv.Itoa(p.Port))
	dialCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	start := time.Now()
	var d net.Dialer
	conn, err := d.DialContext(dialCtx, "tcp", addr)
	elapsed := time.Since(start)
	if err != nil {
		msg := err.Error()
		if errors.Is(err, context.DeadlineExceeded) {
			msg = "таймаут " + strconv.Itoa(int(timeout/time.Millisecond)) + " мс"
		}
		return model.TestResult{TestedAtMs: &now, LastError: msg}
	}
	_ = conn.Close()
	ms := int32(elapsed / time.Millisecond)
	if ms <= 0 {
		ms = 1
	}
	return model.TestResult{LatencyMs: &ms, TestedAtMs: &now}
}

// StopTests — прерывает текущий батч (FR-UI-203).
func (s *Server) StopTests(ctx context.Context, req *connect.Request[lavrayv1.StopTestsRequest]) (*connect.Response[lavrayv1.Empty], error) {
	s.testCancel()()
	return connect.NewResponse(&lavrayv1.Empty{}), nil
}

// ClearTestResults — очищает результаты у выбранных профилей (FR-UI-204).
func (s *Server) ClearTestResults(ctx context.Context, req *connect.Request[lavrayv1.ClearTestResultsRequest]) (*connect.Response[lavrayv1.Empty], error) {
	ids := req.Msg.Ids
	if len(ids) == 0 {
		list, err := s.st.ListProfiles(-1)
		if err != nil {
			return nil, mapErr(err)
		}
		for _, p := range list {
			ids = append(ids, p.ID)
		}
	}
	for _, id := range ids {
		p, err := s.st.GetProfile(id)
		if err != nil {
			continue
		}
		p.TestResult = model.TestResult{}
		if err := s.st.UpdateProfile(p); err != nil {
			return nil, mapErr(err)
		}
	}
	return connect.NewResponse(&lavrayv1.Empty{}), nil
}

// ResetTraffic — обнуление счётчиков трафика профилей (FR-UI-211).
func (s *Server) ResetTraffic(ctx context.Context, req *connect.Request[lavrayv1.ResetTrafficRequest]) (*connect.Response[lavrayv1.Empty], error) {
	ids := req.Msg.Ids
	if len(ids) == 0 {
		list, err := s.st.ListProfiles(-1)
		if err != nil {
			return nil, mapErr(err)
		}
		for _, p := range list {
			ids = append(ids, p.ID)
		}
	}
	for _, id := range ids {
		p, err := s.st.GetProfile(id)
		if err != nil {
			continue
		}
		p.Traffic = model.TrafficCounters{}
		if err := s.st.UpdateProfile(p); err != nil {
			return nil, mapErr(err)
		}
	}
	return connect.NewResponse(&lavrayv1.Empty{}), nil
}
