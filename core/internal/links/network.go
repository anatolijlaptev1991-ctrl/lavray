// SPDX-License-Identifier: GPL-3.0-only

package links

// network.go — допустимые транспорты ссылок и их синонимы.

// networks — транспорты, которые разбирают и собирают ссылки. xhttp (Xray)
// разбирается и хранится, но форк sing-box транспорта не имеет: сборку конфига
// такого профиля отклоняет cfgbuild (transport_support.go), а UI показывает бейдж.
var networks = map[string]bool{
	"tcp": true, "http": true, "ws": true, "grpc": true,
	"httpupgrade": true, "quic": true, "xhttp": true,
}

// canonicalNetwork приводит синонимы транспорта к имени модели: h2 → http,
// splithttp (прежнее имя XHTTP в Xray) → xhttp. Остальное возвращается как есть.
func canonicalNetwork(netw string) string {
	switch netw {
	case "h2":
		return "http"
	case "splithttp":
		return "xhttp"
	}
	return netw
}
