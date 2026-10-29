// SPDX-License-Identifier: GPL-3.0-only

// client.go — клиент обновлений поверх Trust (UPDATE-SYSTEM v2.0 §5):
// порядок root → timestamp → manifest; источники sources.json опрашиваются
// ПАРАЛЛЕЛЬНО, побеждает первый валидный timestamp (свежесть важнее
// порядка); manifest строго по product/channel, serial монотонный,
// expires проверяется; артефакт скачивается с лимитом и сверяется
// sha256. Негативные сценарии §7 — sentinel-ошибки выше (errors.Is).
package updates

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

// Source — откуда тянут метаданные/артефакты (интерфейс для тестов;
// прод: http.Source поверх источников из sources.json).
type Source interface {
	// Fetch возвращает тело по имени (например "timestamp.json") либо ошибку.
	Fetch(ctx context.Context, name string) ([]byte, error)
}

// HTTPSource — HTTP(S)-источник с базой URL (…/releases/download/…).
type HTTPSource struct {
	Base     string
	Client   *http.Client
	MaxBytes int64 // лимит тела (0 → 8 МиБ)
}

func (s *HTTPSource) Fetch(ctx context.Context, name string) ([]byte, error) {
	cl := s.Client
	if cl == nil {
		cl = http.DefaultClient
	}
	limit := s.MaxBytes
	if limit <= 0 {
		limit = 8 << 20
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.Base+"/"+name, nil)
	if err != nil {
		return nil, err
	}
	resp, err := cl.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("updates: %s: HTTP %d", name, resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, limit+1))
}

// Result — успешная проверка обновлений (нет обновления → IsNewer=false).
type Result struct {
	Trust          *Trust
	Timestamp      *Timestamp
	Manifest       *Manifest
	Sources        *Sources
	IsNewer        bool
	Artifact       *Asset // выбранный артефакт платформы (может быть nil)
	ArtifactSHA256 string
	Downloaded     []byte // если Fetcher задан и артефакт скачан
}

// State — состояние клиента (сериализуется в settings update.*; proto-маппинг — api).
type State struct {
	RootVersion    int64
	SerialStable   int64
	SerialBeta     int64
	LastCheckedAt  int64 // ms
	LastWorkingURL string
}

// Client — TUF-lite клиент. Trust — зашитый корень сборки; State —
// персистентная часть; Sources — bootstrap-источники (update 0: GitHub).
type Client struct {
	Trust *Trust
	State *State
	// Product — имя продукта этой сборки ("lavray-windows" | …): манифесты
	// чужих продуктов отвергаются (§7).
	Product string

	// BootstrapSources — источники до первого подписанного sources.json
	// (первая проверка; далее — только подписанные).
	BootstrapSources []Source

	// Now — инъекция времени (тесты).
	Now func() time.Time

	// Channel — запрошенный канал ("stable"/"beta"); пусто = выбрать новейший
	// из обоих (L8 аудита №1: пользователь stable не должен получать beta,
	// у которой просто больше serial).
	Channel string
}

// Check выполняет полный цикл проверки (§5): sources → root(ротация) →
// timestamp(параллельно) → manifest → артефакт (если Fetcher). Контекст
// ограничивает всё.
func (c *Client) Check(ctx context.Context) (*Result, error) {
	if c.Trust == nil {
		return nil, errors.New("updates: Trust не задан")
	}
	now := c.now()

	// U1/W-09 (аудит round 2): срок действия root реально проверяется.
	// Раньше expires только парсился — просроченный корень оставался
	// доверенным бессрочно, а значит freeze/replay не ограничивался.
	if exp := c.Trust.Root().Expires; !exp.IsZero() && !now.Before(exp) {
		return nil, fmt.Errorf("%w: root.json истёк (%s)", ErrExpired, exp.UTC().Format(time.RFC3339))
	}

	// 0) Подписанные sources (параллельно с bootstrap; подписанные приоритетны).
	srcs, signedSources, err := c.fetchSources(ctx, now)
	if err != nil {
		return nil, err
	}

	// 1) ROOT — ДО timestamp (L1 аудита №1): timestamp может быть подписан
	// НОВЫМ ключом после ротации. Если верифицировать timestamp старым root,
	// легитимная ротация навсегда ломает обновления (и отзыв ключа невозможен).
	// Поэтому сначала пробуем подтянуть root N+1 с любого источника: он должен
	// быть подписан порогом СТАРОГО root, после чего Trust переключается.
	for _, s := range srcs {
		rawRoot, ferr := s.Fetch(ctx, "root.json")
		if ferr != nil || len(rawRoot) == 0 {
			continue
		}
		if newTrust, verr := c.Trust.VerifyRootUpdate(rawRoot); verr == nil {
			c.Trust = newTrust
			break
		}
		// Ошибка ротации НЕ фейлит проверку: старый root остаётся валидным
		// до истечения timestamp (SECURITY.md §4.3).
	}

	// 2) timestamp — параллельно, первый валидный (§5 «свежесть»).
	env, ts, src, err := fetchFirstValid(ctx, srcs, "timestamp.json", func(raw []byte) (*Timestamp, error) {
		env, err := c.Trust.Verify(raw, "timestamp")
		if err != nil {
			return nil, err
		}
		ts, err := ParseTimestamp(env.Signed)
		if err != nil {
			return nil, err
		}
		if expires(ts.Expires, now) {
			return nil, fmt.Errorf("%w: timestamp истёк", ErrExpired)
		}
		// U2/W-09: окно свежести ≤ 7 суток (§3.2) — иначе подписанный
		// timestamp с expires через годы открывает freeze-атаку.
		if ts.Expires.After(now.Add(maxTimestampHorizon)) {
			return nil, fmt.Errorf("%w: timestamp.expires=%s", ErrTimestampHorizon,
				ts.Expires.UTC().Format(time.RFC3339))
		}
		return ts, nil
	})
	if err != nil {
		return nil, err
	}
	_ = env

	// 3) manifest — стабильный и beta; выбор канала по большему serial,
	// который > сохранённого (downgrade-защита §7).
	mf, isNewer, channel, err := c.pickManifest(ctx, src, ts, now)
	if err != nil {
		return nil, err
	}

	res := &Result{
		Trust:     c.Trust,
		Timestamp: ts,
		Manifest:  mf,
		Sources:   signedSources,
		IsNewer:   isNewer,
	}
	if c.State != nil {
		c.State.LastCheckedAt = now.UnixMilli()
		c.State.RootVersion = int64(c.Trust.Root().Version)
		c.State.LastWorkingURL = sourceBase(src)
		// L5 аудита №1: serial — МАКСИМУМ из сохранённого и выбранного, иначе
		// деградировавшее зеркало откатывало счётчик и открывало повторный
		// downgrade-replay.
		if channel == "stable" {
			if int64(mf.Serial) > c.State.SerialStable {
				c.State.SerialStable = int64(mf.Serial)
			}
		} else if int64(mf.Serial) > c.State.SerialBeta {
			c.State.SerialBeta = int64(mf.Serial)
		}
	}
	return res, nil
}

// fetchSources — подписанный sources.json с любого источника; fallback —
// bootstrap (только если подписанного ещё нет/не получился).
func (c *Client) fetchSources(ctx context.Context, now time.Time) ([]Source, *Sources, error) {
	all := make([]Source, 0, len(c.BootstrapSources))
	all = append(all, c.BootstrapSources...)
	var signed *Sources
	for _, s := range all {
		raw, err := s.Fetch(ctx, "sources.json")
		if err != nil || len(raw) == 0 {
			continue
		}
		env, err := c.Trust.Verify(raw, "sources")
		if err != nil {
			continue
		}
		parsed, err := ParseSources(env.Signed)
		if err != nil {
			continue
		}
		if expires(parsed.Expires, now) {
			continue
		}
		signed = parsed
		break
	}
	if signed != nil {
		for _, base := range signed.Metadata {
			all = append(all, &HTTPSource{Base: base})
		}
	}
	if len(all) == 0 {
		return nil, nil, errors.New("updates: нет доступных источников")
	}
	return all, signed, nil
}

// pickManifest — стабильный+beta, валидация по §5, выбор новее сохранённого.
func (c *Client) pickManifest(ctx context.Context, src Source, ts *Timestamp, now time.Time) (*Manifest, bool, string, error) {
	type cand struct {
		mf      *Manifest
		channel string
	}
	var cands []cand
	channels := []string{"stable", "beta"}
	if c.Channel != "" {
		channels = []string{c.Channel}
	}
	for _, channel := range channels {
		name := ManifestName(channel)
		entry, ok := ts.Meta[name]
		if !ok {
			continue
		}
		raw, err := src.Fetch(ctx, name)
		if err != nil {
			continue
		}
		env, err := c.Trust.Verify(raw, "manifest")
		if err != nil {
			continue // подпись/порог — пропускаем источник для этого файла
		}
		// L6 аудита №1: timestamp ПИННИТ sha256 и length манифеста (§3.2).
		// Без этой сверки подмена тела manifest-<channel>.json (тот же serial,
		// валидная подпись на другом документе) проходила незамеченной.
		if entry.Sha256 != "" {
			sum := sha256.Sum256(env.Signed)
			if hex.EncodeToString(sum[:]) != entry.Sha256 {
				continue
			}
		}
		if entry.Length > 0 && int64(len(env.Signed)) != entry.Length {
			continue
		}
		mf, err := ParseManifest(env.Signed)
		if err != nil {
			continue
		}
		if mf.Channel != channel {
			continue // §7: чужой channel
		}
		if c.Product != "" && mf.Product != c.Product {
			continue // §7: чужой product
		}
		if int64(mf.Serial) != entry.Serial {
			continue // timestamp≠manifest — подмена/частичная публикация
		}
		if expires(mf.Expires, now) {
			continue
		}
		// L7 аудита №1: секции app/core опциональны в манифесте (бывают
		// релизы только пресетов/гео) — не разыменовываем их вслепую.

		cands = append(cands, cand{mf, channel})
	}
	if len(cands) == 0 {
		return nil, false, "", errors.New("updates: ни один валидный manifest не получен")
	}
	// Выбор: новее сохранённого serial; при равных — stable приоритет.
	best := cands[0]
	for _, c2 := range cands[1:] {
		if c2.mf.Serial > best.mf.Serial {
			best = c2
		}
	}
	st := c.State
	if st != nil {
		saved := st.SerialStable
		if best.channel == "beta" {
			saved = st.SerialBeta
		}
		if int64(best.mf.Serial) <= saved {
			return best.mf, false, best.channel, nil // downgrade/повтор — не обновление
		}
	}
	return best.mf, true, best.channel, nil
}

// DownloadArtifact — скачивание выбранного актива с проверкой sha256 и
// лимитом (путь в манифесте уже проверен checkRelativePath).
func (c *Client) DownloadArtifact(ctx context.Context, src Source, mf *Manifest, key string, maxBytes int64) ([]byte, error) {
	asset, ok := mf.App.Assets[key]
	if !ok {
		return nil, fmt.Errorf("updates: манифест не содержит актив %q", key)
	}
	if maxBytes <= 0 {
		maxBytes = 512 << 20
	}
	raw, err := src.Fetch(ctx, asset.Path)
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > maxBytes {
		return nil, errors.New("updates: артефакт превышает лимит размера")
	}
	if int64(len(raw)) != asset.Length {
		return nil, errors.New("updates: длина артефакта не совпала с манифестом")
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != asset.Sha256 {
		return nil, errors.New("updates: sha256 артефакта не совпал с манифестом")
	}
	return raw, nil
}

// fetchFirstValid — опрашивает источники параллельно; первый успешный
// результат закрывает остальные (контекст-отмена).
func fetchFirstValid[T any](ctx context.Context, srcs []Source, name string, parse func([]byte) (*T, error)) (*Envelope, *T, Source, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	type out struct {
		env *Envelope
		val *T
		src Source
	}
	res := make(chan out, len(srcs))
	errs := make(chan error, len(srcs))
	var wg sync.WaitGroup
	for _, s := range srcs {
		wg.Add(1)
		go func(s Source) {
			defer wg.Done()
			raw, err := s.Fetch(ctx, name)
			if err != nil {
				errs <- err
				return
			}
			// Разбор: конвейер (подпись → структура) передаётся целиком в
			// parse через обёртку — здесь только доставление.
			env, err := parseEnvelopeOnly(raw)
			if err != nil {
				errs <- err
				return
			}
			val, err := parse(raw)
			if err != nil {
				errs <- err
				return
			}
			select {
			case res <- out{env, val, s}:
			case <-ctx.Done():
			}
		}(s)
	}
	go func() { wg.Wait(); close(res); close(errs) }()
	var lastErr error
	for {
		select {
		case o, ok := <-res:
			if !ok {
				if lastErr == nil {
					lastErr = errors.New("updates: все источники недоступны")
				}
				return nil, nil, nil, lastErr
			}
			return o.env, o.val, o.src, nil
		case err := <-errs:
			if lastErr == nil {
				lastErr = err
			}
		}
	}
}

func parseEnvelopeOnly(raw []byte) (*Envelope, error) {
	return ParseEnvelope(raw)
}

func (c *Client) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

// maxTimestampHorizon — максимальное окно свежести timestamp (§3.2).
const maxTimestampHorizon = 7 * 24 * time.Hour

func expires(t time.Time, now time.Time) bool {
	return !now.Before(t) // zero time = истёкший (строгость)
}

func sourceBase(s Source) string {
	if h, ok := s.(*HTTPSource); ok {
		return h.Base
	}
	return ""
}
