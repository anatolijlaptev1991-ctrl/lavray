package api

import (
	"context"
	"os"
	"testing"
	"time"

	"connectrpc.com/connect"
	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/inst"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
)

func rollbackTestServer(t *testing.T) (*Server, *store.Store) {
	t.Helper()
	// Не t.TempDir(): гонка RemoveAll с -wal/-shm на Windows (см. newE2E).
	dir, err := os.MkdirTemp("", "lavray-rollback-*")
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = st.Close()
		for i := 0; i < 50; i++ {
			if os.RemoveAll(dir) == nil {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	})
	return NewServer(Deps{Store: st, Runner: &inst.FakeRunner{}}), st
}

// T-17 (A1-10, B2-11): Rollback не трогает монотонные serial каналов.
// Раньше он записывал update.serial_stable/beta = 0, и после одного вызова
// принимался любой подписанный манифест канала, в том числе старый (защита
// от downgrade и от повтора старого манифеста, UPDATE-SYSTEM §2).
func TestRollbackKeepsMonotonicSerials(t *testing.T) {
	srv, st := rollbackTestServer(t)
	ctx := context.Background()
	if err := st.SetSetting(setUpdSerialSt, "42"); err != nil {
		t.Fatal(err)
	}
	if err := st.SetSetting(setUpdSerialBe, "57"); err != nil {
		t.Fatal(err)
	}

	for _, comp := range []lavrayv1.UpdateComponent{
		lavrayv1.UpdateComponent_UPDATE_COMPONENT_APP,
		lavrayv1.UpdateComponent_UPDATE_COMPONENT_CORE,
	} {
		if _, err := srv.Rollback(ctx, connect.NewRequest(&lavrayv1.RollbackRequest{Component: comp})); err != nil {
			t.Fatalf("Rollback(%v): %v", comp, err)
		}
	}

	for key, want := range map[string]string{setUpdSerialSt: "42", setUpdSerialBe: "57"} {
		got, ok, err := st.GetSetting(key)
		if err != nil || !ok || got != want {
			t.Errorf("%s после Rollback = %q (найден=%v, err=%v), ожидалось %q", key, got, ok, err, want)
		}
	}
	state, err := srv.GetUpdateState(ctx, connect.NewRequest(&lavrayv1.GetUpdateStateRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if ms := state.Msg.GetChainState().GetMaxSerial(); ms["stable"] != 42 || ms["beta"] != 57 {
		t.Errorf("GetUpdateState.MaxSerial = %v, ожидалось stable=42 beta=57", ms)
	}
}

// Запрос без компонента по-прежнему отвергается и ничего не меняет.
func TestRollbackWithoutComponentIsRejected(t *testing.T) {
	srv, st := rollbackTestServer(t)
	_ = st.SetSetting(setUpdSerialSt, "42")
	_, err := srv.Rollback(context.Background(), connect.NewRequest(&lavrayv1.RollbackRequest{}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("Rollback без component: %v, ожидался INVALID_ARGUMENT", err)
	}
	if got, _, _ := st.GetSetting(setUpdSerialSt); got != "42" {
		t.Fatalf("serial_stable = %q после отклонённого запроса", got)
	}
}
