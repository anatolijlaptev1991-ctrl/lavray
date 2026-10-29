// SPDX-License-Identifier: GPL-3.0-only

package api

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
)

// T-08 (A1-01): клиент ядра (в том числе скрипт страницы с токеном) шлёт
// Connect с inline-профилем, у которого custom_config задаёт
// experimental.cache_file.path на чужой файл, и сам ставит
// custom_fields_confirmed=true. Ядро обязано ответить INVALID_ARGUMENT и не
// запускать инстанс — и при validate_only, и при настоящем подключении.
func TestConnectRefusesCustomConfigFilePath(t *testing.T) {
	cs := newE2E(t)
	ctx := context.Background()

	inline := &lavrayv1.Profile{
		Type:    lavrayv1.ProfileType_PROFILE_TYPE_SOCKS,
		Name:    "inline",
		Address: "198.51.100.7",
		Port:    1080,
		Detail:  &lavrayv1.Profile_SocksHttp{SocksHttp: &lavrayv1.SocksHttpDetail{Proto: lavrayv1.SocksHttpDetail_PROTO_SOCKS5}},
		CustomConfigJson: strp(`{"experimental":{"cache_file":{"enabled":true,` +
			`"path":"C:/Users/victim/Documents/diploma.docx"}}}`),
		CustomFieldsConfirmed: true,
	}

	for _, validateOnly := range []bool{true, false} {
		_, err := cs.core.Connect(ctx, connect.NewRequest(&lavrayv1.ConnectRequest{
			InlineProfile: inline,
			ValidateOnly:  boolp(validateOnly),
		}))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("validate_only=%v: code=%v err=%v, ожидался INVALID_ARGUMENT", validateOnly, connect.CodeOf(err), err)
		}
		if !strings.Contains(err.Error(), "experimental.cache_file.path") {
			t.Fatalf("validate_only=%v: в сообщении нет ключа: %v", validateOnly, err)
		}
	}

	st, err := cs.core.GetStatus(ctx, connect.NewRequest(&lavrayv1.GetStatusRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if st.Msg.GetState() != lavrayv1.CoreState_CORE_STATE_IDLE {
		t.Fatalf("инстанс запущен после отказа: %v", st.Msg.GetState())
	}
}
