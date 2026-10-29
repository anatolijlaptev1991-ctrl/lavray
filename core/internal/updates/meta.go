// SPDX-License-Identifier: GPL-3.0-only

// Package updates — TUF-lite клиент обновлений LAVRay (UPDATE-SYSTEM v2.0,
// core-port-plan §9 W8): четыре подписанных документа root/timestamp/
// manifest/sources, верификация ed25519 по ролям корня, монотонный serial
// по каналу, ротация root порогом СТАРЫХ ключей, отзыв ключа — удалением из
// keys (SECURITY.md §4).
//
// Доверие даёт подпись, а не хост (принцип 6): allowlist источников — только
// из подписанного sources.json; в коде URL-пиннинга нет, bootstrap-список
// передаётся конфигурацией сборки.
//
// Фаза 1 (решение владельца 2026-10-23): root содержит один ключ k1 с
// threshold 1; формат и верификация порога полностью поддерживают целевое
// состояние 2-из-3 (k1/k2/k3 threshold 2) — покрыто тестами ротации/отзыва.
package updates

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
)

// ============================================================================
// Ошибки (сентинелы для errors.Is; api-слой маппит их в Connect-коды)
// ============================================================================

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

// ============================================================================
// Конверт {"signed": …, "signatures":[{keyid,sig}…]} (§3)
// ============================================================================

// MetaSignature — одна подпись: keyid из root.json + подпись ed25519 над
// БАЙТАМИ объекта signed (канонизированный JSON передаётся как есть).
type MetaSignature struct {
	Keyid string `json:"keyid"`
	Sig   string `json:"sig"` // base64 (std) ed25519, 64 байта
}

// Envelope — конверт подписанного документа.
type Envelope struct {
	Signed     json.RawMessage `json:"signed"`
	Signatures []MetaSignature `json:"signatures"`
}

// ParseEnvelope — строгий разбор конверта: только поля signed/signatures,
// подписи непустые и декодируются в 64 байта ed25519.
func ParseEnvelope(raw []byte) (*Envelope, error) {
	var env Envelope
	if err := decodeStrict(raw, &env); err != nil {
		return nil, fmt.Errorf("конверт: %w", err)
	}
	if len(env.Signed) == 0 {
		return nil, fmt.Errorf("%w: конверт без поля signed", ErrMissingField)
	}
	if len(env.Signatures) == 0 {
		return nil, fmt.Errorf("%w: конверт без signatures", ErrMissingField)
	}
	for i, s := range env.Signatures {
		if s.Keyid == "" {
			return nil, fmt.Errorf("%w: signatures[%d].keyid пуст", ErrBadValue, i)
		}
		sig, err := base64.StdEncoding.DecodeString(s.Sig)
		if err != nil || len(sig) != ed25519.SignatureSize {
			return nil, fmt.Errorf("%w: signatures[%d].sig не является ed25519-подписью (base64, %d байт)", ErrBadValue, i, ed25519.SignatureSize)
		}
	}
	return &env, nil
}

// ============================================================================
// root.json (§3.1)
// ============================================================================

// PublicKey — публичный ключ из root.json.
type PublicKey struct {
	Alg string `json:"alg"` // "ed25519"
	Pub string `json:"pub"` // base64 (std), 32 байта
}

// Role — роль и её порог подписей.
type Role struct {
	Keyids    []string `json:"keyids"`
	Threshold int      `json:"threshold"`
}

// Root — подписанная часть root.json.
type Root struct {
	Type    string               `json:"type"`
	Version int64                `json:"version"`
	Expires time.Time            `json:"expires"`
	Keys    map[string]PublicKey `json:"keys"`
	Roles   map[string]Role      `json:"roles"`
}

// Роли корня (§3.1): root/timestamp/manifest/sources.
const (
	RoleRoot      = "root"
	RoleTimestamp = "timestamp"
	RoleManifest  = "manifest"
	RoleSources   = "sources"
)

// ParseRoot — строгий разбор подписанной части root.json + структурная
// валидация: ключи ed25519, роли полны, порог достижим, keyid существуют.
func ParseRoot(signed json.RawMessage) (*Root, error) {
	if err := requireKeys(signed, "type", "version", "expires", "keys", "roles"); err != nil {
		return nil, err
	}
	var r Root
	if err := decodeStrict(signed, &r); err != nil {
		return nil, fmt.Errorf("root: %w", err)
	}
	if r.Type != RoleRoot {
		return nil, fmt.Errorf("%w: root.json имеет type=%q", ErrWrongType, r.Type)
	}
	if r.Version < 1 {
		return nil, fmt.Errorf("%w: root.version=%d < 1", ErrBadValue, r.Version)
	}
	if r.Expires.IsZero() {
		return nil, fmt.Errorf("%w: root.expires отсутствует", ErrMissingField)
	}
	if len(r.Keys) == 0 {
		return nil, fmt.Errorf("%w: root.keys пуст", ErrBadValue)
	}
	for id, k := range r.Keys {
		if k.Alg != "ed25519" {
			return nil, fmt.Errorf("%w: ключ %s: alg=%q (поддерживается только ed25519)", ErrBadValue, id, k.Alg)
		}
		pub, err := base64.StdEncoding.DecodeString(k.Pub)
		if err != nil || len(pub) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("%w: ключ %s: pub не является ed25519-ключом (base64, %d байт)", ErrBadValue, id, ed25519.PublicKeySize)
		}
	}
	for _, role := range []string{RoleRoot, RoleTimestamp, RoleManifest, RoleSources} {
		rl, ok := r.Roles[role]
		if !ok {
			return nil, fmt.Errorf("%w: root.roles без роли %q", ErrMissingField, role)
		}
		if rl.Threshold < 1 {
			return nil, fmt.Errorf("%w: роль %s: threshold=%d < 1", ErrBadValue, role, rl.Threshold)
		}
		if len(rl.Keyids) < rl.Threshold {
			return nil, fmt.Errorf("%w: роль %s: keyids (%d) меньше threshold (%d)", ErrBadValue, role, len(rl.Keyids), rl.Threshold)
		}
		seen := map[string]bool{}
		for _, id := range rl.Keyids {
			if id == "" {
				return nil, fmt.Errorf("%w: роль %s: пустой keyid", ErrBadValue, role)
			}
			if seen[id] {
				return nil, fmt.Errorf("%w: роль %s: дубликат keyid %s", ErrBadValue, role, id)
			}
			seen[id] = true
			if _, ok := r.Keys[id]; !ok {
				return nil, fmt.Errorf("%w: роль %s: keyid %s отсутствует в keys", ErrBadValue, role, id)
			}
		}
	}
	return &r, nil
}

// ============================================================================
// timestamp.json (§3.2)
// ============================================================================

// TimestampEntry — запись о манифесте канала в timestamp.json.
type TimestampEntry struct {
	Serial int64  `json:"serial"`
	Sha256 string `json:"sha256"` // hex
	Length int64  `json:"length"`
}

// Timestamp — подписанная часть timestamp.json.
type Timestamp struct {
	Type    string                    `json:"type"`
	Version int64                     `json:"version"`
	Expires time.Time                 `json:"expires"`
	Meta    map[string]TimestampEntry `json:"meta"` // "manifest-<channel>.json" → запись
}

// ParseTimestamp — строгий разбор подписанной части timestamp.json.
func ParseTimestamp(signed json.RawMessage) (*Timestamp, error) {
	if err := requireKeys(signed, "type", "version", "expires", "meta"); err != nil {
		return nil, err
	}
	var ts Timestamp
	if err := decodeStrict(signed, &ts); err != nil {
		return nil, fmt.Errorf("timestamp: %w", err)
	}
	if ts.Type != RoleTimestamp {
		return nil, fmt.Errorf("%w: timestamp.json имеет type=%q", ErrWrongType, ts.Type)
	}
	if ts.Version < 1 {
		return nil, fmt.Errorf("%w: timestamp.version=%d < 1", ErrBadValue, ts.Version)
	}
	if ts.Expires.IsZero() {
		return nil, fmt.Errorf("%w: timestamp.expires отсутствует", ErrMissingField)
	}
	if len(ts.Meta) == 0 {
		return nil, fmt.Errorf("%w: timestamp.meta пуст", ErrBadValue)
	}
	for name, e := range ts.Meta {
		if !strings.HasPrefix(name, "manifest-") || !strings.HasSuffix(name, ".json") {
			return nil, fmt.Errorf("%w: timestamp.meta: неожиданный ключ %q (ожидается manifest-<channel>.json)", ErrBadValue, name)
		}
		if e.Serial < 1 {
			return nil, fmt.Errorf("%w: timestamp.meta[%s].serial=%d < 1", ErrBadValue, name, e.Serial)
		}
		if err := checkHex64(e.Sha256); err != nil {
			return nil, fmt.Errorf("timestamp.meta[%s].sha256: %w", name, err)
		}
		if e.Length < 1 {
			return nil, fmt.Errorf("%w: timestamp.meta[%s].length=%d < 1", ErrBadValue, name, e.Length)
		}
	}
	return &ts, nil
}

// ============================================================================
// manifest.json (§3.3)
// ============================================================================

// Asset — платформенный артефакт приложения/ядра.
type Asset struct {
	Path    string `json:"path"`    // относительный путь на источнике
	Sha256  string `json:"sha256"`  // hex
	Length  int64  `json:"length"`  // байт
	Minisig string `json:"minisig"` // minisign; trusted comment product;platform;channel;version;serial
}

// AppSection — секция app манифеста.
type AppSection struct {
	Version        string           `json:"version"`
	MinUpgradeFrom string           `json:"minUpgradeFrom,omitempty"`
	Assets         map[string]Asset `json:"assets"` // "windows-x64" → артефакт
}

// CoreSection — секция core (§7: отдельная доставка, своя схема версий).
type CoreSection struct {
	Version string `json:"version"` // "1.14.1-lav.N"
	MinApp  string `json:"minApp"`  // минимальная версия приложения
}

// PresetEntry — подписанный пресет (§8: rev, не semver).
type PresetEntry struct {
	Rev    int64  `json:"rev"`
	Path   string `json:"path"`
	Sha256 string `json:"sha256"`
}

// GeoSection — подписанный набор гео-данных (LNB-31).
type GeoSection struct {
	Path        string `json:"path"`
	Sha256      string `json:"sha256"`
	Length      int64  `json:"length"`
	GeneratedAt string `json:"generatedAt,omitempty"`
}

// Manifest — подписанная часть manifest.json. product/channel/serial/
// expires/mandatory — ВНУТРИ подписи (§2: downgrade/mix-and-match/подмена
// канала/DoS через mandatory).
type Manifest struct {
	Type      string                 `json:"type"`
	Product   string                 `json:"product"` // "lavray-windows" | …
	Channel   string                 `json:"channel"` // "stable" | "beta"
	Serial    int64                  `json:"serial"`  // монотонный по каналу
	Expires   time.Time              `json:"expires"`
	App       *AppSection            `json:"app,omitempty"`
	Core      *CoreSection           `json:"core,omitempty"`
	Presets   map[string]PresetEntry `json:"presets,omitempty"`
	Geo       *GeoSection            `json:"geo,omitempty"`
	Notes     map[string]string      `json:"notes,omitempty"`
	Mandatory *bool                  `json:"mandatory"`
}

// Каналы (§1 принцип 5).
const (
	ChannelStable = "stable"
	ChannelBeta   = "beta"
)

// ManifestName — имя файла манифеста канала в timestamp.meta и на источнике.
func ManifestName(channel string) string { return "manifest-" + channel + ".json" }

// ParseManifest — строгий разбор подписанной части manifest.json.
func ParseManifest(signed json.RawMessage) (*Manifest, error) {
	if err := requireKeys(signed, "type", "product", "channel", "serial", "expires", "mandatory"); err != nil {
		return nil, err
	}
	var m Manifest
	if err := decodeStrict(signed, &m); err != nil {
		return nil, fmt.Errorf("manifest: %w", err)
	}
	if m.Type != RoleManifest {
		return nil, fmt.Errorf("%w: manifest.json имеет type=%q", ErrWrongType, m.Type)
	}
	if m.Product == "" {
		return nil, fmt.Errorf("%w: manifest.product пуст", ErrBadValue)
	}
	if m.Channel != ChannelStable && m.Channel != ChannelBeta {
		return nil, fmt.Errorf("%w: manifest.channel=%q (ожидается stable|beta)", ErrBadValue, m.Channel)
	}
	if m.Serial < 1 {
		return nil, fmt.Errorf("%w: manifest.serial=%d < 1", ErrBadValue, m.Serial)
	}
	if m.Expires.IsZero() {
		return nil, fmt.Errorf("%w: manifest.expires отсутствует", ErrMissingField)
	}
	if m.Mandatory == nil {
		return nil, fmt.Errorf("%w: manifest.mandatory отсутствует", ErrMissingField)
	}
	if m.App != nil {
		if err := requireSectionKeys(signed, "app", "version", "assets"); err != nil {
			return nil, err
		}
		if m.App.Version == "" {
			return nil, fmt.Errorf("%w: app.version пуст", ErrBadValue)
		}
		if len(m.App.Assets) == 0 {
			return nil, fmt.Errorf("%w: app.assets пуст", ErrBadValue)
		}
		for plat, a := range m.App.Assets {
			if err := validateAsset("app.assets["+plat+"]", a); err != nil {
				return nil, err
			}
		}
	}
	if m.Core != nil {
		if err := requireSectionKeys(signed, "core", "version", "minApp"); err != nil {
			return nil, err
		}
		if m.Core.Version == "" || m.Core.MinApp == "" {
			return nil, fmt.Errorf("%w: core.version/minApp пусты", ErrBadValue)
		}
	}
	for name, p := range m.Presets {
		if p.Rev < 1 {
			return nil, fmt.Errorf("%w: presets[%s].rev=%d < 1", ErrBadValue, name, p.Rev)
		}
		if err := checkRelativePath(p.Path); err != nil {
			return nil, fmt.Errorf("presets[%s].path: %w", name, err)
		}
		if err := checkHex64(p.Sha256); err != nil {
			return nil, fmt.Errorf("presets[%s].sha256: %w", name, err)
		}
	}
	if m.Geo != nil {
		if err := requireSectionKeys(signed, "geo", "path", "sha256", "length"); err != nil {
			return nil, err
		}
		if err := checkRelativePath(m.Geo.Path); err != nil {
			return nil, fmt.Errorf("geo.path: %w", err)
		}
		if err := checkHex64(m.Geo.Sha256); err != nil {
			return nil, fmt.Errorf("geo.sha256: %w", err)
		}
		if m.Geo.Length < 1 {
			return nil, fmt.Errorf("%w: geo.length=%d < 1", ErrBadValue, m.Geo.Length)
		}
	}
	return &m, nil
}

func validateAsset(where string, a Asset) error {
	// path/sha256/length не бывают легитимно пустыми/нулевыми — их явное
	// присутствие в JSON проверяется непустыми значениями ниже.
	if a.Path == "" {
		return fmt.Errorf("%w: %s.path пуст", ErrMissingField, where)
	}
	if a.Sha256 == "" {
		return fmt.Errorf("%w: %s.sha256 пуст", ErrMissingField, where)
	}
	if err := checkRelativePath(a.Path); err != nil {
		return fmt.Errorf("%s.path: %w", where, err)
	}
	if err := checkHex64(a.Sha256); err != nil {
		return fmt.Errorf("%s.sha256: %w", where, err)
	}
	if a.Length < 1 {
		return fmt.Errorf("%w: %s.length=%d < 1", ErrBadValue, where, a.Length)
	}
	return nil
}

// ============================================================================
// sources.json (§3.4)
// ============================================================================

// Sources — подписанная часть sources.json: allowlist зеркал.
type Sources struct {
	Type      string    `json:"type"`
	Version   int64     `json:"version"`
	Expires   time.Time `json:"expires"`
	Artifacts []string  `json:"artifacts"` // базовые URL артефактов
	Metadata  []string  `json:"metadata"`  // базовые URL метаданных
}

// ParseSources — строгий разбор подписанной части sources.json.
// HTTPS-only (§2 MITM/DNS-подмена): http-источники отвергаются.
func ParseSources(signed json.RawMessage) (*Sources, error) {
	if err := requireKeys(signed, "type", "version", "expires", "artifacts", "metadata"); err != nil {
		return nil, err
	}
	var s Sources
	if err := decodeStrict(signed, &s); err != nil {
		return nil, fmt.Errorf("sources: %w", err)
	}
	if s.Type != RoleSources {
		return nil, fmt.Errorf("%w: sources.json имеет type=%q", ErrWrongType, s.Type)
	}
	if s.Version < 1 {
		return nil, fmt.Errorf("%w: sources.version=%d < 1", ErrBadValue, s.Version)
	}
	if s.Expires.IsZero() {
		return nil, fmt.Errorf("%w: sources.expires отсутствует", ErrMissingField)
	}
	if len(s.Artifacts) == 0 || len(s.Metadata) == 0 {
		return nil, fmt.Errorf("%w: sources.artifacts/metadata пусты", ErrBadValue)
	}
	for _, list := range []struct {
		name string
		urls []string
	}{
		{"artifacts", s.Artifacts}, {"metadata", s.Metadata},
	} {
		for _, raw := range list.urls {
			if err := checkSourceURL(raw); err != nil {
				return nil, fmt.Errorf("sources.%s: %w", list.name, err)
			}
		}
	}
	return &s, nil
}

// checkSourceURL — только https, без фрагментов/запросов, непустой хост.
func checkSourceURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("%w: %q не разбирается", ErrBadURL, raw)
	}
	if u.Scheme != "https" {
		return fmt.Errorf("%w: %q не https", ErrBadURL, raw)
	}
	if u.Host == "" || u.Fragment != "" || u.RawQuery != "" || u.User != nil {
		return fmt.Errorf("%w: %q (хост/фрагмент/запрос/учётные данные)", ErrBadURL, raw)
	}
	return nil
}

// ============================================================================
// Верификация подписей (ed25519, порог роли)
// ============================================================================

// VerifyEnvelope — проверка конверта против роли корня доверия: каждая
// подпись считается только если keyid есть в keys И входит в роль; для
// подсчёта ключ учитывается один раз; валидных ≥ threshold.
//
// Отзыв (SECURITY §4.1): ключ, удалённый из keys новой версией root, здесь
// просто не находится — его подписи перестают считаться без изменения кода.
func VerifyEnvelope(env *Envelope, role string, root *Root) error {
	rl, ok := root.Roles[role]
	if !ok {
		return fmt.Errorf("%w: %q", ErrBadRole, role)
	}
	inRole := map[string]bool{}
	for _, id := range rl.Keyids {
		inRole[id] = true
	}
	valid := map[string]bool{}
	for _, s := range env.Signatures {
		if valid[s.Keyid] || !inRole[s.Keyid] {
			continue
		}
		key, ok := root.Keys[s.Keyid]
		if !ok {
			continue // отозванный/неизвестный ключ не считается
		}
		pub, err := base64.StdEncoding.DecodeString(key.Pub)
		if err != nil || len(pub) != ed25519.PublicKeySize {
			continue
		}
		sig, err := base64.StdEncoding.DecodeString(s.Sig)
		if err != nil || len(sig) != ed25519.SignatureSize {
			continue
		}
		if !ed25519.Verify(ed25519.PublicKey(pub), env.Signed, sig) {
			continue // неверная подпись этим ключом — не считается
		}
		valid[s.Keyid] = true
	}
	if len(valid) < rl.Threshold {
		return fmt.Errorf("%w: роль %s — валидных %d из %d (порог %d)", ErrInsufficientSignatures, role, len(valid), len(rl.Keyids), rl.Threshold)
	}
	return nil
}

// ============================================================================
// Корень доверия: пин, верификация, ротация
// ============================================================================

// Trust — текущий корень доверия: проверенный root.json (пин приложения или
// результат ротации) + разобранная подписанная часть.
type Trust struct {
	raw  []byte
	root *Root
}

// NewTrust — пин корня в приложении: строгий разбор + самоподпись по
// собственной роли root (целостность внедрённого документа).
func NewTrust(rootJSON []byte) (*Trust, error) {
	env, err := ParseEnvelope(rootJSON)
	if err != nil {
		return nil, err
	}
	root, err := ParseRoot(env.Signed)
	if err != nil {
		return nil, err
	}
	if err := VerifyEnvelope(env, RoleRoot, root); err != nil {
		return nil, err
	}
	return &Trust{raw: append([]byte(nil), rootJSON...), root: root}, nil
}

// Root — разобранная подписанная часть корня.
func (t *Trust) Root() *Root { return t.root }

// Raw — байты доверенного root.json (персистентность update.root_json).
func (t *Trust) Raw() []byte { return append([]byte(nil), t.raw...) }

// Verify — разобрать и проверить подпись документа для роли корня доверия.
// Возвращает конверт; подписанная часть — env.Signed.
func (t *Trust) Verify(raw []byte, role string) (*Envelope, error) {
	env, err := ParseEnvelope(raw)
	if err != nil {
		return nil, err
	}
	if err := VerifyEnvelope(env, role, t.root); err != nil {
		return nil, err
	}
	return env, nil
}

// VerifyRootUpdate — ротация корня (§3 правила, SECURITY §4.1): root.json
// версии N+1, подписанный порогом СТАРЫХ ключей роли root. Возвращает новый
// Trust; старый остаётся нетронутым при ошибке.
func (t *Trust) VerifyRootUpdate(raw []byte) (*Trust, error) {
	env, err := ParseEnvelope(raw)
	if err != nil {
		return nil, err
	}
	newRoot, err := ParseRoot(env.Signed)
	if err != nil {
		return nil, err
	}
	if newRoot.Version != t.root.Version+1 {
		return nil, fmt.Errorf("%w: текущая %d, кандидат %d (нужна ровно N+1)", ErrRootNotAdvanced, t.root.Version, newRoot.Version)
	}
	if err := VerifyEnvelope(env, RoleRoot, t.root); err != nil {
		return nil, fmt.Errorf("ротация root: %w", err)
	}
	// M1 (аудит round 2): TUF требует, чтобы новый root был подписан и
	// НОВЫМИ ключами самого документа — иначе один скомпрометированный
	// старый ключ переписывает всю базу доверия.
	if err := VerifyEnvelope(env, RoleRoot, newRoot); err != nil {
		return nil, fmt.Errorf("ротация root: не подписан новыми ключами: %w", err)
	}
	// Срок действия нового корня тоже обязан быть в будущем.
	if newRoot.Expires.IsZero() || !time.Now().Before(newRoot.Expires) {
		return nil, fmt.Errorf("%w: новый root просрочен или без expires", ErrExpired)
	}
	return &Trust{raw: append([]byte(nil), raw...), root: newRoot}, nil
}

// ============================================================================
// Хелперы строгого JSON
// ============================================================================

// decodeStrict — декодирует ровно один JSON-документ без неизвестных полей
// и лишнего контента после него.
func decodeStrict(data []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("%w: %v", ErrBadJSON, err)
	}
	if dec.More() {
		return fmt.Errorf("%w: лишний контент после JSON-документа", ErrBadJSON)
	}
	return nil
}

// requireKeys — все перечисленные ключи обязаны присутствовать в объекте
// (encoding/json не различает «0/false» и «отсутствует»).
func requireKeys(signed json.RawMessage, keys ...string) error {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(signed, &m); err != nil {
		return fmt.Errorf("%w: подписанная часть не является объектом: %v", ErrBadJSON, err)
	}
	for _, k := range keys {
		if _, ok := m[k]; !ok {
			return fmt.Errorf("%w: %q", ErrMissingField, k)
		}
	}
	return nil
}

// requireSectionKeys — presence подсекции с обязательными ключами.
func requireSectionKeys(signed json.RawMessage, section string, keys ...string) error {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(signed, &m); err != nil {
		return fmt.Errorf("%w: %v", ErrBadJSON, err)
	}
	sub, ok := m[section]
	if !ok {
		return nil // секция опциональна; обязательность её полей — когда есть
	}
	return requireKeys(sub, keys...)
}

// checkHex64 — строка является 64-символьным hex sha256.
func checkHex64(s string) error {
	if len(s) != 64 {
		return fmt.Errorf("%w: не 64 hex-символа (%d)", ErrBadValue, len(s))
	}
	if _, err := hex.DecodeString(s); err != nil {
		return fmt.Errorf("%w: не hex: %v", ErrBadValue, err)
	}
	return nil
}

// checkRelativePath — относительный путь без выхода за корень (zip-slip
// профилактика на уровне манифеста; повторяется при staging).
func checkRelativePath(p string) error {
	if p == "" {
		return fmt.Errorf("%w: пустой путь", ErrUnsafePath)
	}
	if strings.Contains(p, "\\") {
		return fmt.Errorf("%w: обратный слэш в пути %q", ErrUnsafePath, p)
	}
	if strings.HasPrefix(p, "/") {
		return fmt.Errorf("%w: абсолютный путь %q", ErrUnsafePath, p)
	}
	// W-10 (аудит round 2): Windows-специфика. «C:evil» — drive-relative путь,
	// «a.exe:stream» — альтернативный поток данных NTFS; «CON»/«NUL» —
	// зарезервированные имена устройств; хвостовые пробелы/точки Windows
	// молча отбрасывает, что позволяет обойти проверку расширения.
	if strings.ContainsRune(p, 0) {
		return fmt.Errorf("%w: NUL-байт в пути", ErrUnsafePath)
	}
	if strings.Contains(p, ":") {
		return fmt.Errorf("%w: двоеточие в пути %q (ADS/диск)", ErrUnsafePath, p)
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return fmt.Errorf("%w: сегмент %q в пути %q", ErrUnsafePath, seg, p)
		}
		trimmed := strings.TrimRight(seg, " .")
		if trimmed != seg {
			return fmt.Errorf("%w: сегмент %q оканчивается пробелом/точкой", ErrUnsafePath, seg)
		}
		base := strings.ToUpper(strings.TrimSuffix(trimmed, path.Ext(trimmed)))
		switch base {
		case "CON", "PRN", "AUX", "NUL",
			"COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
			"LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9":
			return fmt.Errorf("%w: зарезервированное имя %q", ErrUnsafePath, seg)
		}
	}
	return nil
}

// ============================================================================
// Сравнение версий (stdlib-only)
// ============================================================================

// CompareVersions — сравнение точечных числовых версий приложения
// ("1.2.0" vs "1.10.1"); нечисловые части сравниваются лексикографически.
func CompareVersions(a, b string) int {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	n := len(pa)
	if len(pb) > n {
		n = len(pb)
	}
	for i := 0; i < n; i++ {
		sa, sb := "0", "0"
		if i < len(pa) {
			sa = pa[i]
		}
		if i < len(pb) {
			sb = pb[i]
		}
		na, ea := strconv.Atoi(sa)
		nb, eb := strconv.Atoi(sb)
		if ea != nil || eb != nil {
			if c := strings.Compare(sa, sb); c != 0 {
				return c
			}
			continue
		}
		if na != nb {
			if na < nb {
				return -1
			}
			return 1
		}
	}
	return 0
}

// CompareCoreVersions — сравнение версий ядра по СОБСТВЕННОЙ схеме
// "1.14.1-lav.N" (§7: semver-сравнение с upstream запрещено; здесь
// сравниваются только lav-версии между собой: база числово, затем lav.N).
func CompareCoreVersions(a, b string) int {
	baseA, lavA := splitLav(a)
	baseB, lavB := splitLav(b)
	if c := CompareVersions(baseA, baseB); c != 0 {
		return c
	}
	switch {
	case lavA < lavB:
		return -1
	case lavA > lavB:
		return 1
	}
	return 0
}

// splitLav — "1.14.1-lav.3" → ("1.14.1", 3); без суффикса → (s, 0).
func splitLav(s string) (string, int64) {
	i := strings.Index(s, "-lav.")
	if i < 0 {
		return s, 0
	}
	n, err := strconv.ParseInt(s[i+len("-lav."):], 10, 64)
	if err != nil {
		return s, 0
	}
	return s[:i], n
}
