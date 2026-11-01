// SPDX-License-Identifier: GPL-3.0-only

// errors.go — sentinel-ошибки подсистемы обновлений (errors.Is); api-слой
// раскладывает их в Connect-коды и причины (update_reasons.go).
package updates

import "errors"

var (
	// ErrBadJSON — документ не разбирается строгим парсером (неизвестное
	// поле, битый синтаксис, лишний контент).
	ErrBadJSON = errors.New("updates: некорректный JSON метаданных")
	// ErrMissingField — отсутствует обязательное поле.
	ErrMissingField = errors.New("updates: отсутствует обязательное поле")
	// ErrBadValue — поле присутствует, но значение недопустимо (alg, hex,
	// длина ключа, порог и т.п.).
	ErrBadValue = errors.New("updates: недопустимое значение поля")
	// ErrWrongType — поле type не соответствует ожидаемому документу.
	ErrWrongType = errors.New("updates: неверный type документа")
	// ErrBadSignature — подпись не сошлась (подписано другим ключом/данными).
	ErrBadSignature = errors.New("updates: неверная подпись")
	// ErrInsufficientSignatures — валидных подписей меньше порога роли.
	ErrInsufficientSignatures = errors.New("updates: недостаточно подписей (порог не достигнут)")
	// ErrBadRole — роль отсутствует в root.json.
	ErrBadRole = errors.New("updates: роль не описана в root.json")
	// ErrExpired — документ просрочен (expires в прошлом).
	ErrExpired = errors.New("updates: документ просрочен")
	// ErrTimestampHorizon — timestamp живёт дольше допустимых 7 дней (§3.2).
	ErrTimestampHorizon = errors.New("updates: timestamp.expires дальше 7 дней")
	// ErrRootNotAdvanced — версия корня не N+1 / не растёт (откат root).
	ErrRootNotAdvanced = errors.New("updates: версия root.json не растёт (N+1)")
	// ErrWrongProduct — чужой product (§2 «подмена канала/продукта»).
	ErrWrongProduct = errors.New("updates: чужой product манифеста")
	// ErrWrongChannel — чужой channel (beta вместо stable).
	ErrWrongChannel = errors.New("updates: чужой channel манифеста")
	// ErrSerialRollback — serial не больше сохранённого максимума (§2 откат).
	ErrSerialRollback = errors.New("updates: serial манифеста не возрастает")
	// ErrHashMismatch — sha256 не совпал (артефакт или манифест против
	// timestamp; §2 mix-and-match).
	ErrHashMismatch = errors.New("updates: sha256 не совпал")
	// ErrLengthMismatch — длина не совпала с манифестом/timestamp.
	ErrLengthMismatch = errors.New("updates: длина не совпала")
	// ErrUnsafePath — путь артефакта пытается выйти за корень (zip-slip).
	ErrUnsafePath = errors.New("updates: небезопасный путь артефакта")
	// ErrBadURL — источник не HTTPS или не разбирается (§2 MITM).
	ErrBadURL = errors.New("updates: недопустимый URL источника")
	// ErrNotConfigured — отсутствует внедрённая конфигурация (root/staging).
	ErrNotConfigured = errors.New("updates: подсистема обновлений не сконфигурирована")
	// ErrNoCheck — Download/Apply без успешной проверки (нет манифеста).
	ErrNoCheck = errors.New("updates: сначала выполните проверку (CheckUpdates)")
	// ErrNotStaged — Apply без скачанного/верифицированного компонента.
	ErrNotStaged = errors.New("updates: компонент не скачан (нет staging)")
	// ErrActiveSession — применение при активной сессии без подтверждения
	// (принцип 1: туннель не ломаем).
	ErrActiveSession = errors.New("updates: активная сессия — подтвердите применение при ней")
	// ErrAppTooOld — версия приложения < minApp для ядра (§7).
	ErrAppTooOld = errors.New("updates: версия приложения ниже minApp ядра")
	// ErrNetwork — все источники/попытки недоступны (не «нет обновлений»,
	// а «проверка не удалась» — принцип 7).
	ErrNetwork = errors.New("updates: все источники недоступны")
)
