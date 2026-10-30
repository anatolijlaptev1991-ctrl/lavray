// SPDX-License-Identifier: GPL-3.0-only

package traffic

import (
	"math"
	"sort"
	"time"
)

// otherTag — тег для соединения, у которого исходящий не определён.
const otherTag = "other"

// Meter считает скорости по тегам из разности счётчиков соединений между
// двумя вызовами Tick. Один Meter — один потребитель (один поток Subscribe):
// у каждого свой интервал и своя точка отсчёта. Не потокобезопасен.
type Meter struct {
	started bool
	prevAt  time.Time
	gen     uint64
	seen    map[string]seenConn
	tags    map[string]*tagAcc
}

// seenConn — что известно о соединении с прошлого Tick.
type seenConn struct {
	up, down int64
	gen      uint64
}

// tagAcc — накопители одного тега: прибавка за такт и итог с начала работы.
type tagAcc struct {
	dUp, dDown         int64 // байты, перенесённые за этот такт (для скорости)
	upTotal, downTotal int64
}

// NewMeter создаёт пустой счётчик: первый Tick только запоминает состояние.
func NewMeter() *Meter {
	return &Meter{seen: map[string]seenConn{}, tags: map[string]*tagAcc{}}
}

// Tick принимает состояние источника на момент now и возвращает по каждому
// известному тегу скорость за прошедшее время и накопленный объём.
//
//   - Первый Tick скорость не считает (нет базы для разности), а объём берёт
//     как есть: соединения жили до подписки.
//   - Скорость = прибавка байт / фактическое время между Tick, а не заданный
//     интервал: тик с запозданием не завышает и не занижает её.
//   - Соединение, закрывшееся между тактами, учитывается ОДИН раз: на том Tick,
//     где оно впервые появилось закрытым; в следующих его разность нулевая.
//   - Счётчик, ушедший назад (сброс), даёт 0, а не отрицательное число.
//   - Соединения, пропавшие и из active, и из closed, забываются: карта не растёт.
func (m *Meter) Tick(now time.Time, active, closed []ConnInfo) []TagRate {
	first := !m.started
	dt := now.Sub(m.prevAt).Seconds()
	m.gen++
	for _, acc := range m.tags {
		acc.dUp, acc.dDown = 0, 0
	}
	m.observe(active, first)
	m.observe(closed, first)
	for id, c := range m.seen {
		if c.gen != m.gen {
			delete(m.seen, id)
		}
	}
	m.started, m.prevAt = true, now
	return m.rates(first, dt)
}

// observe применяет разность по каждому соединению списка.
func (m *Meter) observe(conns []ConnInfo, first bool) {
	for i := range conns {
		c := &conns[i]
		prev, known := m.seen[c.ID]
		if prev.gen == m.gen {
			continue // тот же id в обоих списках: считаем один раз
		}
		dUp, dDown := nonNegative(c.Up), nonNegative(c.Down) // новое: всё передано за такт
		if known {
			dUp, dDown = nonNegative(c.Up-prev.up), nonNegative(c.Down-prev.down)
		}
		acc := m.tagAcc(c)
		acc.upTotal = addSat(acc.upTotal, dUp)
		acc.downTotal = addSat(acc.downTotal, dDown)
		if !first {
			acc.dUp = addSat(acc.dUp, dUp)
			acc.dDown = addSat(acc.dDown, dDown)
		}
		m.seen[c.ID] = seenConn{up: c.Up, down: c.Down, gen: m.gen}
	}
}

func (m *Meter) tagAcc(c *ConnInfo) *tagAcc {
	tag := c.Outbound
	if tag == "" {
		tag = otherTag
	}
	acc, ok := m.tags[tag]
	if !ok {
		acc = &tagAcc{}
		m.tags[tag] = acc
	}
	return acc
}

// rates собирает итог такта, теги по алфавиту.
func (m *Meter) rates(first bool, dt float64) []TagRate {
	out := make([]TagRate, 0, len(m.tags))
	for tag, acc := range m.tags {
		r := TagRate{Tag: tag, UpTotal: acc.upTotal, DownTotal: acc.downTotal}
		if !first && dt > 0 {
			r.UpBps = float64(acc.dUp) / dt
			r.DownBps = float64(acc.dDown) / dt
		}
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Tag < out[j].Tag })
	return out
}

func nonNegative(v int64) int64 {
	if v < 0 {
		return 0
	}
	return v
}

// addSat складывает неотрицательные числа без переполнения: на мусорных
// счётчиках источника итог упирается в потолок, а не уходит в минус.
func addSat(a, b int64) int64 {
	if a > math.MaxInt64-b {
		return math.MaxInt64
	}
	return a + b
}
