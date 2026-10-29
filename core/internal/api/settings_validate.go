// SPDX-License-Identifier: GPL-3.0-only

// settings_validate.go — проверка значений SetSettings (T-34): тип по
// дескриптору, диапазоны портов и MTU, адрес, список допустимых значений.
// Невалидное значение отвергается целиком (INVALID_ARGUMENT) до записи.
package api

import (
	"encoding/json"
	"net"

	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
)

// intRanges — допустимые границы целочисленных настроек (включительно).
var intRanges = map[string][2]int64{
	"inbound.port":    {1, 65535},
	"tun.mtu":         {1280, 9000},
	"tun.impl":        {1, 3},
	"mux.concurrency": {-1, 1024},
}

// stringChoices — настройки с фиксированным набором значений.
var stringChoices = map[string][]string{
	"mux.protocol": {"h2mux", "smux", "yamux"},
}

// validateSetting проверяет одно значение известного ключа (неизвестные ключи
// SetSettings не применяет и сюда не передаёт).
func validateSetting(key string, d model.SettingDescriptor, v *lavrayv1.SettingValue) error {
	switch d.Type {
	case model.SettingString:
		if _, ok := v.GetValue().(*lavrayv1.SettingValue_StringValue); !ok {
			return invalidArg("%s: ожидалась строка", key)
		}
	case model.SettingBool:
		if _, ok := v.GetValue().(*lavrayv1.SettingValue_BoolValue); !ok {
			return invalidArg("%s: ожидалось логическое значение", key)
		}
	case model.SettingInt:
		if _, ok := v.GetValue().(*lavrayv1.SettingValue_IntValue); !ok {
			return invalidArg("%s: ожидалось целое число", key)
		}
	case model.SettingDouble:
		if _, ok := v.GetValue().(*lavrayv1.SettingValue_DoubleValue); !ok {
			return invalidArg("%s: ожидалось число", key)
		}
	case model.SettingStringList:
		if _, ok := v.GetValue().(*lavrayv1.SettingValue_StringListValue); !ok {
			return invalidArg("%s: ожидался список строк", key)
		}
	case model.SettingJSON:
		j, ok := v.GetValue().(*lavrayv1.SettingValue_JsonValue)
		if !ok || !json.Valid([]byte(j.JsonValue)) {
			return invalidArg("%s: ожидался корректный JSON", key)
		}
	}
	if r, ok := intRanges[key]; ok {
		if n := v.GetIntValue(); n < r[0] || n > r[1] {
			return invalidArg("%s: значение %d вне диапазона %d–%d", key, n, r[0], r[1])
		}
	}
	if list, ok := stringChoices[key]; ok {
		s := v.GetStringValue()
		for _, x := range list {
			if s == x {
				return nil
			}
		}
		return invalidArg("%s: значение %q недопустимо (%v)", key, s, list)
	}
	if key == "inbound.address" {
		if a := v.GetStringValue(); a != "localhost" && net.ParseIP(a) == nil {
			return invalidArg("inbound.address: %q — не IP-адрес (127.0.0.1, 0.0.0.0 или localhost)", a)
		}
	}
	return nil
}
