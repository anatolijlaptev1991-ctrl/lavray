package store

import (
	"errors"
	"testing"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
)

// t51Seed — группа с профилями A и B; t51Names — имена профилей группы.
func t51Seed(t *testing.T) (*Store, *model.Group, *model.Profile, *model.Profile) {
	t.Helper()
	s := openTemp(t)
	g := newGroup("g", model.GroupBasic)
	if err := s.CreateGroup(g); err != nil {
		t.Fatal(err)
	}
	a := newProfile(g.ID, model.TypeSOCKS, "A", "a.example", 1000)
	b := newProfile(g.ID, model.TypeSOCKS, "B", "b.example", 1001)
	for _, p := range []*model.Profile{a, b} {
		if err := s.CreateProfile(p); err != nil {
			t.Fatal(err)
		}
	}
	return s, g, a, b
}

func t51Names(t *testing.T, s *Store, groupID int64) string {
	t.Helper()
	list, err := s.ListProfiles(groupID)
	if err != nil {
		t.Fatal(err)
	}
	names := ""
	for _, p := range list {
		names += p.Name + " "
	}
	return names
}

// T-51: ошибка внутри InTx откатывает ВСЕ записи серии — создание, обновление
// и удаление (DeleteProfile раньше шёл мимо транзакции и внутри неё завис бы).
// Таймаут страхует от взаимной блокировки на единственном соединении пула.
func TestInTxRollsBackEverythingOnError(t *testing.T) {
	s, g, a, b := t51Seed(t)
	boom := errors.New("boom")
	done := make(chan error, 1)
	go func() {
		done <- s.InTx(func(tx *Store) error {
			if err := tx.CreateProfile(newProfile(g.ID, model.TypeSOCKS, "C", "c.example", 1002)); err != nil {
				return err
			}
			renamed := *a
			renamed.Name = "A2"
			if err := tx.UpdateProfile(&renamed); err != nil {
				return err
			}
			if err := tx.DeleteProfile(b.ID); err != nil {
				return err
			}
			return boom
		})
	}()
	select {
	case err := <-done:
		if !errors.Is(err, boom) {
			t.Fatalf("InTx вернул %v, ожидалась ошибка fn", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("InTx завис (взаимная блокировка на единственном соединении пула)")
	}
	if got := t51Names(t, s, g.ID); got != "A B " {
		t.Fatalf("после отката группа = %q, ожидалось \"A B \"", got)
	}
}

// Паника внутри fn (как «убитый посреди обновления процесс») не оставляет
// частичных записей и не оставляет транзакцию открытой.
func TestInTxRollsBackOnPanic(t *testing.T) {
	s, g, _, _ := t51Seed(t)
	func() {
		defer func() {
			if recover() == nil {
				t.Error("паника fn должна дойти до вызывающего")
			}
		}()
		_ = s.InTx(func(tx *Store) error {
			if err := tx.CreateProfile(newProfile(g.ID, model.TypeSOCKS, "C", "c.example", 1002)); err != nil {
				return err
			}
			panic("процесс убит")
		})
	}()
	if got := t51Names(t, s, g.ID); got != "A B " {
		t.Fatalf("после паники группа = %q, ожидалось \"A B \"", got)
	}
	if err := s.CreateProfile(newProfile(g.ID, model.TypeSOCKS, "D", "d.example", 1003)); err != nil {
		t.Fatalf("хранилище не пригодно после паники в InTx: %v", err)
	}
}
