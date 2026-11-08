// SPDX-License-Identifier: GPL-3.0-only

package api

// test_flight.go — учёт идущих пакетных тестов (single-flight по профилю).
// Повторный TestLatency по профилю, который уже проверяется, получает
// ALREADY_EXISTS: измерение не запускается второй раз, нагрузка не
// умножается. Батчи с непересекающимися профилями идут независимо, а
// StopTests отменяет все (раньше отмена хранилась одна на процесс, и второй
// батч затирал её у первого).

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
)

// testItem — профиль батча, прочитанный до начала измерений.
type testItem struct {
	p *model.Profile
}

// testRun — идущие батчи: отмены и занятые профили (профиль → номер батча).
type testRun struct {
	next    int
	cancels map[int]context.CancelFunc
	busy    map[int64]int
}

// beginTestBatch регистрирует батч. Пересечение с идущим батчем по профилям —
// ALREADY_EXISTS без побочных эффектов. finish снимает только свои записи.
func (s *Server) beginTestBatch(items []testItem, cancel context.CancelFunc) (func(), error) {
	s.testsMu.Lock()
	defer s.testsMu.Unlock()
	if s.testsRunning == nil {
		s.testsRunning = &testRun{}
	}
	r := s.testsRunning
	if r.cancels == nil {
		r.cancels, r.busy = map[int]context.CancelFunc{}, map[int64]int{}
	}
	for _, it := range items {
		if _, taken := r.busy[it.p.ID]; taken {
			return nil, connect.NewError(connect.CodeAlreadyExists,
				fmt.Errorf("профиль %d уже проверяется: дождитесь конца теста или остановите его (StopTests)", it.p.ID))
		}
	}
	r.next++
	id := r.next
	r.cancels[id] = cancel
	for _, it := range items {
		r.busy[it.p.ID] = id
	}
	return func() {
		s.testsMu.Lock()
		defer s.testsMu.Unlock()
		delete(r.cancels, id)
		for _, it := range items {
			if r.busy[it.p.ID] == id {
				delete(r.busy, it.p.ID)
			}
		}
	}, nil
}

// cancelTestBatches — StopTests: отменяет все батчи и сразу освобождает
// профили, чтобы новый запуск не упирался в ещё разматывающийся старый.
func (s *Server) cancelTestBatches() {
	s.testsMu.Lock()
	defer s.testsMu.Unlock()
	r := s.testsRunning
	if r == nil {
		return
	}
	for _, c := range r.cancels {
		c()
	}
	r.busy = map[int64]int{}
}
