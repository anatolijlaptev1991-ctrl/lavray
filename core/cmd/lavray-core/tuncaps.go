// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"errors"
	"strconv"
	"strings"
)

// capNetAdmin — номер CAP_NET_ADMIN (linux/capability.h): право создавать TUN и
// менять маршруты. На Linux его получает файл ядра (setcap при установке пакета
// или по запросу пароля в окне приложения), а не процесс оболочки.
const capNetAdmin = 12

// errTunNoNetAdmin — понятная причина отказа TUN на Linux для клиентов, которые
// не могут показать диалог выдачи прав (агенты MCP, headless). Без неё агент
// получил бы сырой «operation not permitted» от sing-box.
var errTunNoNetAdmin = errors.New("режим TUN недоступен: у ядра LAVRay нет права управлять сетью (CAP_NET_ADMIN). " +
	"Включите TUN в окне LAVRay — приложение предложит выдать право одним запросом пароля, — " +
	"или переключите режим на системный прокси")

// hasEffectiveCap сообщает, есть ли бит capability в строке CapEff файла
// /proc/<pid>/status. Неразборчивый или отсутствующий CapEff — false.
func hasEffectiveCap(status string, capability uint) bool {
	if capability > 63 {
		return false
	}
	for line := range strings.SplitSeq(status, "\n") {
		hex, ok := strings.CutPrefix(line, "CapEff:")
		if !ok {
			continue
		}
		mask, err := strconv.ParseUint(strings.TrimSpace(hex), 16, 64)
		if err != nil {
			return false
		}
		return mask&(1<<capability) != 0
	}
	return false
}
