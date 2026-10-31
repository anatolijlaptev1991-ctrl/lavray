// SPDX-License-Identifier: GPL-3.0-only

package api

// traffic_accountant.go — учёт трафика сессии (T-79): байты инстанса попадают
// в счётчики профиля (profiles.uplink_total/downlink_total) и в таблицу
// sessions. Сброс идёт каждые 30 с, при остановке (Disconnect, перезапуск,
// Shutdown) и при падении инстанса, чтобы авария теряла не больше последнего
// интервала. Что не успело сброситься, потеряно не навсегда: сессию без конца
// закроет store.Open (CloseDanglingSessions).

import (
	"sync"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/inst"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/logs"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/traffic"
)

// accountingFlushInterval — период сброса счётчиков в базу.
const accountingFlushInterval = 30 * time.Second

// acctClock — часы учёта; нулевое значение — настоящие. Тесты подставляют свои.
type acctClock struct {
	now    func() time.Time
	ticker func(d time.Duration) (<-chan time.Time, func())
}

func (c acctClock) Now() time.Time {
	if c.now != nil {
		return c.now()
	}
	return time.Now()
}

func (c acctClock) Ticker(d time.Duration) (<-chan time.Time, func()) {
	if c.ticker != nil {
		return c.ticker(d)
	}
	t := time.NewTicker(d)
	return t.C, t.Stop
}

// trafficAccountant — состояние учёта сервера; нулевое значение готово к работе.
type trafficAccountant struct {
	mu    sync.Mutex
	clock acctClock
	cur   *acctSession // сессия идущего подключения; nil — подключения нет
}

// acctSession — одна сессия: что записано в базу и что уже сброшено.
type acctSession struct {
	id        int64
	profileID int64 // 0 — подключение без сохранённого профиля
	src       traffic.Source
	up, down  int64 // сброшено в профиль (профиль получает прибавки, не итоги)
	stop      chan struct{}
}

// beginAccounting открывает сессию для только что запущенного инстанса и
// запускает её сброс по таймеру. Прежняя сессия, если осталась, закрывается.
func (s *Server) beginAccounting() {
	run := s.inst.Status().Run
	if run == nil {
		return
	}
	s.endAccounting()
	var profileID, groupID *int64
	if run.ProfileID != 0 {
		profileID, groupID = int64p(run.ProfileID), int64p(run.GroupID)
	}
	id, err := s.st.StartSession(profileID, groupID, run.Mode, run.StartedAtMs)
	if err != nil {
		s.logs.Logf(logs.LevelWarn, logs.SourceCore, "учёт трафика: сессия не открыта: %v", err)
		return
	}
	if _, err := s.st.PruneSessions(store.MaxSessions); err != nil {
		s.logs.Logf(logs.LevelWarn, logs.SourceCore, "учёт трафика: очистка старых сессий: %v", err)
	}
	sess := &acctSession{id: id, profileID: run.ProfileID, src: s.inst.Traffic(), stop: make(chan struct{})}
	a := &s.acct
	a.mu.Lock()
	a.cur = sess
	a.mu.Unlock()
	events, cancel := s.inst.Subscribe()
	ticks, stopTicker := a.clock.Ticker(accountingFlushInterval)
	go func() {
		defer cancel()
		defer stopTicker()
		s.watchSession(sess, ticks, events)
	}()
	if st := s.inst.Status().State; st != inst.StateReady { // успел упасть до подписки
		s.finishSession(sess)
	}
}

// watchSession сбрасывает счётчики по таймеру и завершает сессию, когда
// инстанс остановился или упал.
func (s *Server) watchSession(sess *acctSession, ticks <-chan time.Time, events <-chan inst.Event) {
	for {
		select {
		case <-sess.stop:
			return
		case <-ticks:
			s.flushSession(sess, false)
		case ev, ok := <-events:
			if !ok || ev.Status.State == inst.StateIdle || ev.Status.State == inst.StateCrashed {
				s.finishSession(sess)
				return
			}
		}
	}
}

// endAccounting завершает идущую сессию: итоговый сброс и время конца.
// Повторный вызов и вызов без сессии ничего не делают.
func (s *Server) endAccounting() {
	a := &s.acct
	a.mu.Lock()
	sess := a.cur
	a.mu.Unlock()
	if sess != nil {
		s.finishSession(sess)
	}
}

// flushAccounting сбрасывает счётчики идущей сессии сейчас: чтение итогов не
// должно отставать от живого трафика на период таймера.
func (s *Server) flushAccounting() {
	a := &s.acct
	a.mu.Lock()
	sess := a.cur
	a.mu.Unlock()
	if sess != nil {
		s.flushSession(sess, false)
	}
}

// finishSession — итоговый сброс; сессия перестаёт быть текущей. Вызывается из
// нескольких мест (Disconnect, событие остановки, перезапуск): выигрывает первый.
func (s *Server) finishSession(sess *acctSession) {
	a := &s.acct
	a.mu.Lock()
	if a.cur != sess {
		a.mu.Unlock()
		return
	}
	a.cur = nil
	a.mu.Unlock()
	s.flushSession(sess, true)
	close(sess.stop)
}

// flushSession пишет в базу то, что накопилось с прошлого сброса. Профиль
// получает прибавку, сессия — абсолютные итоги. Ошибка записи не продвигает
// отметку «сброшено»: следующий сброс повторит. Тексты ошибок базы адресов
// назначения не содержат.
func (s *Server) flushSession(sess *acctSession, end bool) {
	a := &s.acct
	a.mu.Lock()
	defer a.mu.Unlock()
	var up, down int64
	if sess.src != nil {
		up, down = sess.src.Total()
	}
	if sess.profileID != 0 && (up > sess.up || down > sess.down) {
		err := s.st.AddTraffic(sess.profileID, max(up-sess.up, 0), max(down-sess.down, 0))
		if err != nil {
			s.logs.Logf(logs.LevelWarn, logs.SourceCore, "учёт трафика: счётчики профиля: %v", err)
		} else {
			sess.up, sess.down = max(up, sess.up), max(down, sess.down)
		}
	}
	now := a.clock.Now().UnixMilli()
	write := s.st.UpdateSession
	if end {
		write = s.st.EndSession
	}
	if err := write(sess.id, up, down, now); err != nil {
		s.logs.Logf(logs.LevelWarn, logs.SourceCore, "учёт трафика: сессия %d: %v", sess.id, err)
	}
}
