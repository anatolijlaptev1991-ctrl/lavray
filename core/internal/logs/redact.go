package logs

import (
	"regexp"
	"strings"
)

// Redact вычищает секреты из строки лога (LNB-01/28; ядро — единая точка
// «log.sanitize» из fix-плана BUGS.md п.1). Порядок: сначала URL (userinfo +
// секретные query-параметры), затем JSON-поля, затем env-пары и содержимое
// share-ссылок. Всё — регэкспы по СТРОКЕ (не парсинг JSON): лог — это текст,
// обломки JSON в нём встречаются в произвольном контексте.
//
// Именование «секретных» ключей консервативно с запасом: password, passwd,
// pass, pwd, token, secret, uuid, private_key, privatekey, auth, key,
// credential(s), sni? — НЕТ: sni не секрет. Короткие ключи (key, auth)
// применяются ТОЛЬКО в query/env/JSON-контексте с якорями, чтобы не резать
// обычные слова («keyword», «monitoring» и пр.).
const redacted = "[REDACTED]"

// 1) userinfo URL: scheme://user:pass@… → scheme://[REDACTED]@…
// (логин И пароль целиком — логин тоже персональнаяdata, LNB-01).
var reURLUserinfo = regexp.MustCompile(`(?i)([a-z][a-z0-9+.-]*://)([^\s/@:@"']+)(:[^\s/@]+)?@`)

// 2) секретные query-параметры: ?token=…&share_token=…&key=… (в т.ч. внутри
// полного URL). Значение до & / пробела / конца. Подстрока «key» ловится и
// внутри составных имён (api_key, licensekey) — перередакция безопаснее
// пропуска (better over-redact than leak).
var reQuerySecret = regexp.MustCompile(`(?i)([?&](?:[a-z0-9_.-]*` + `(?:token|secret|password|passwd|pwd|key|auth)` + `[a-z0-9_.-]*)=)([^&#\s]*)`)

// 3) JSON-поля: "password": "value" → "[REDACTED]" (двойные кавычки;
// пробелы вокруг двоеточия; одноимённые ключи с суффиксами не трогаются —
// «passed»:… не совпадает, т.к. после pass требуется кавычка/двоеточие).
var reJSONSecret = regexp.MustCompile(`(?i)("?(?:password|passwd|pwd|pass|token|secret|uuid|private_key|privatekey|credential|credentials|auth)"?\s*:\s*)"[^"]*"`)

// 4) env-пары: PASSWORD=value / SECRET_TOKEN=value (граница слова слева,
// значение до пробела/конца) — LNB-28 (env внешних ядер).
var reEnvSecret = regexp.MustCompile(`(?i)(\b[A-Z0-9_]*(?:PASSWORD|PASSWD|TOKEN|SECRET|PRIVATE_KEY|PRIVATEKEY)[A-Z0-9_]*=)([^\s]*)`)

// 5) share/happ-ссылки: содержимое после схемы скрывается ЦЕЛИКОМ (внутри
// base64/happ — пароли и UUID, LNB-01: «содержимое share/happ-ссылок»).
var reShareLinks = regexp.MustCompile(`(?i)\b(vmess|vless|trojan|ss|hysteria2?|hy2|tuic|happ|nekoray|sn)://[^\s#]*`)

// 6) Authorization-заголовки (Basic/Bearer) — токен целиком.
var reAuthHeader = regexp.MustCompile(`(?i)(authorization\s*[:=]\s*(?:basic|bearer)\s+)[^\s]+`)

// Redact применяет все правила; секретных вхождений в результате нет.
func Redact(s string) string {
	if s == "" {
		return s
	}
	s = reURLUserinfo.ReplaceAllString(s, `$1`+redacted+`@`)
	s = reQuerySecret.ReplaceAllString(s, `${1}`+redacted)
	s = reJSONSecret.ReplaceAllString(s, `$1"`+redacted+`"`)
	s = reEnvSecret.ReplaceAllString(s, `$1`+redacted)
	s = reAuthHeader.ReplaceAllString(s, `$1`+redacted)
	s = reShareLinks.ReplaceAllStringFunc(s, func(m string) string {
		i := strings.Index(m, "://")
		if i < 0 {
			return m
		}
		return m[:i+3] + redacted
	})
	return s
}

// ansiEscape — CSI/OSC-последовательности (FR-UI-218: VT100-чистка в ядре).
var ansiEscape = regexp.MustCompile(`\x1b(?:\[[0-9;?]*[a-zA-Z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])`)

// StripANSI удаляет ANSI/VT100-последовательности (цвета внешних ядер и пр.).
func StripANSI(s string) string {
	return ansiEscape.ReplaceAllString(s, "")
}
