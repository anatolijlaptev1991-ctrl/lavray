// client_test.go — негативные сценарии UPDATE-SYSTEM §7 + ротация/отзыв
// ключей SECURITY.md §4. Все метаданные генерируются на лету: ключи ed25519,
// подписи envelope, строгий порядок проверки.
package updates

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

// ---- тестовая инфраструктура ---------------------------------------------------

type memSource struct {
	mu    sync.Mutex
	files map[string][]byte
}

func (m *memSource) Fetch(_ context.Context, name string) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if b, ok := m.files[name]; ok {
		return append([]byte(nil), b...), nil
	}
	return nil, fmt.Errorf("нет файла %s", name)
}

func (m *memSource) put(name string, b []byte) { m.files[name] = b }

type signer struct {
	priv ed25519.PrivateKey
}

func newSigner(t *testing.T) signer {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return signer{priv: priv}
}

// signEnv — конверт {"signed":…, "signatures":[…]} по образцу §3; keyid —
// имя ключа из root.keys (роли ссылаются на эти имена).
func (s signer) signEnv(signed json.RawMessage, keyid string) []byte {
	sig := ed25519.Sign(s.priv, signed)
	env := map[string]any{
		"signed":     json.RawMessage(signed),
		"signatures": []any{map[string]any{"keyid": keyid, "sig": base64.StdEncoding.EncodeToString(sig)}},
	}
	b, err := json.Marshal(env)
	if err != nil {
		panic(err)
	}
	return b
}

func b64pub(t *testing.T, s signer) string {
	t.Helper()
	pub := s.priv.Public().(ed25519.PublicKey)
	return base64.StdEncoding.EncodeToString(pub)
}

// fixture — генератор валидного набора метаданных для одного trust-набора
// ключей (root — signers роли).
type fixture struct {
	rootS   signer // подписывает root
	tsS     signer // timestamp
	manS    signer // manifest+sources
	srcRole string
}

func newFixture(t *testing.T) fixture {
	return fixture{rootS: newSigner(t), tsS: newSigner(t), manS: newSigner(t), srcRole: "r1"}
}

func (f fixture) rootJSON(t *testing.T) []byte {
	t.Helper()
	root := map[string]any{
		"type": "root", "version": 1, "expires": time.Now().Add(365 * 24 * time.Hour).UTC().Format(time.RFC3339),
		"keys": map[string]any{
			"k1": map[string]any{"alg": "ed25519", "pub": b64pub(t, f.rootS)},
			"t1": map[string]any{"alg": "ed25519", "pub": b64pub(t, f.tsS)},
			"r1": map[string]any{"alg": "ed25519", "pub": b64pub(t, f.manS)},
		},
		"roles": map[string]any{
			"root":      map[string]any{"keyids": []string{"k1"}, "threshold": 1},
			"timestamp": map[string]any{"keyids": []string{"t1"}, "threshold": 1},
			"manifest":  map[string]any{"keyids": []string{f.srcRole}, "threshold": 1},
			"sources":   map[string]any{"keyids": []string{f.srcRole}, "threshold": 1},
		},
	}
	b, err := json.Marshal(root)
	if err != nil {
		t.Fatal(err)
	}
	return f.rootS.signEnv(b, "k1")
}

func (f fixture) publish(t *testing.T, m *memSource, serial int32, opts pubOpts) {
	t.Helper()
	now := time.Now().UTC()
	fakeSum := sha256.Sum256([]byte("fake-artifact"))
	man := map[string]any{
		"type": "manifest", "product": opts.product, "channel": opts.channel,
		"serial": serial, "expires": now.Add(30 * 24 * time.Hour).Format(time.RFC3339),
		"app": map[string]any{"version": "1.2.0", "minUpgradeFrom": "1.0.0", "assets": map[string]any{
			"windows-x64": map[string]any{"path": "v1/app.exe", "sha256": hex.EncodeToString(fakeSum[:]), "length": 12, "minisig": "sig"},
		}},
		"core":      map[string]any{"version": "1.14.1-lav.1", "minApp": "1.2.0"},
		"presets":   map[string]any{},
		"geo":       map[string]any{"path": "geo/1.tar.zst", "sha256": strings.Repeat("a", 64), "length": 100},
		"notes":     map[string]any{"ru": "n"},
		"mandatory": false,
	}
	manB, _ := json.Marshal(man)
	tsEntry := map[string]any{"serial": serial, "sha256": fmt.Sprintf("%x", sha256.Sum256(manB)), "length": len(manB)}
	ts := map[string]any{
		"type": "timestamp", "version": 1,
		"expires": now.Add(time.Duration(opts.tsTTL) * time.Second).Format(time.RFC3339),
		"meta": map[string]any{
			"manifest-stable.json": tsEntry,
			"manifest-beta.json":   tsEntry,
		},
	}
	tsB, _ := json.Marshal(ts)
	sources := map[string]any{
		"type": "sources", "version": 3,
		"expires":   now.Add(180 * 24 * time.Hour).Format(time.RFC3339),
		"artifacts": []string{"https://updates.example/"},
		"metadata":  []string{"https://updates.example/meta/"},
	}
	sourcesB, _ := json.Marshal(sources)
	m.put("root.json", f.rootJSON(t))
	m.put("timestamp.json", f.tsS.signEnv(tsB, "t1"))
	m.put("manifest-stable.json", f.manS.signEnv(manB, "r1"))
	m.put("manifest-beta.json", f.manS.signEnv(manB, "r1"))
	m.put("sources.json", f.manS.signEnv(sourcesB, "r1"))
}

type pubOpts struct {
	product string
	channel string
	tsTTL   int // секунды до expires timestamp
}

func validOpts() pubOpts {
	return pubOpts{product: "lavray-windows", channel: "stable", tsTTL: 7 * 24 * 3600}
}

func newClient(t *testing.T, f fixture, m *memSource, st *State) *Client {
	t.Helper()
	trust, err := NewTrust(f.rootJSON(t))
	if err != nil {
		t.Fatal(err)
	}
	return &Client{Trust: trust, State: st, Product: "lavray-windows", BootstrapSources: []Source{m}}
}

// ---- тесты ---------------------------------------------------------------------

func TestCheckHappyPathNewerAndRepeat(t *testing.T) {
	f := newFixture(t)
	m := &memSource{files: map[string][]byte{}}
	f.publish(t, m, 42, validOpts())
	st := &State{}
	c := newClient(t, f, m, st)

	res, err := c.Check(context.Background())
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if !res.IsNewer || res.Manifest.Serial != 42 {
		t.Fatalf("res: newer=%v serial=%d", res.IsNewer, res.Manifest.Serial)
	}
	if st.SerialStable != 42 || st.RootVersion != 1 {
		t.Fatalf("state: %+v", st)
	}

	// Повтор с тем же serial — не обновление (downgrade/repeat).
	f.publish(t, m, 42, validOpts())
	res2, err := c.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res2.IsNewer {
		t.Fatal("тот же serial не должен быть обновлением")
	}
}

func TestDowngradeSerialRejected(t *testing.T) {
	f := newFixture(t)
	m := &memSource{files: map[string][]byte{}}
	f.publish(t, m, 50, validOpts())
	st := &State{}
	c := newClient(t, f, m, st)
	if _, err := c.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	f.publish(t, m, 30, validOpts()) // «откат» сервера
	res, err := c.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.IsNewer {
		t.Fatal("downgrade serial принят как обновление")
	}
}

func TestWrongProductRejected(t *testing.T) {
	f := newFixture(t)
	m := &memSource{files: map[string][]byte{}}
	opts := validOpts()
	opts.product = "lavray-linux" // чужой продукт
	f.publish(t, m, 42, opts)
	c := newClient(t, f, m, &State{})
	if _, err := c.Check(context.Background()); err == nil {
		t.Fatal("чужой product должен быть отвергнут")
	}
}

func TestExpiredTimestampRejected(t *testing.T) {
	f := newFixture(t)
	m := &memSource{files: map[string][]byte{}}
	opts := validOpts()
	opts.tsTTL = -10 // уже истёк
	f.publish(t, m, 42, opts)
	c := newClient(t, f, m, &State{})
	_, err := c.Check(context.Background())
	if err == nil || !strings.Contains(err.Error(), "истёк") {
		t.Fatalf("истёкший timestamp: err=%v", err)
	}
}

func TestForeignSignatureRejected(t *testing.T) {
	f := newFixture(t)
	m := &memSource{files: map[string][]byte{}}
	f.publish(t, m, 42, validOpts())
	// Переподписать timestamp чужим ключом.
	rogue := newSigner(t)
	ts := map[string]any{
		"type": "timestamp", "version": 1,
		"expires": time.Now().Add(7 * 24 * time.Hour).UTC().Format(time.RFC3339),
		"meta":    map[string]any{},
	}
	b, _ := json.Marshal(ts)
	m.put("timestamp.json", rogue.signEnv(b, "t1"))
	c := newClient(t, f, m, &State{})
	_, err := c.Check(context.Background())
	if err == nil {
		t.Fatal("подпись чужим ключом принята")
	}
}

func TestRootRotationByOldThreshold(t *testing.T) {
	f := newFixture(t)
	m := &memSource{files: map[string][]byte{}}
	f.publish(t, m, 42, validOpts())
	c := newClient(t, f, m, &State{})
	if _, err := c.Check(context.Background()); err != nil {
		t.Fatal(err)
	}

	// Ротация: root v2 c НОВЫМ ключом k2, подписан СТАРЫМ k1 (threshold 1).
	newRootSigner := newSigner(t)
	root2 := map[string]any{
		"type": "root", "version": 2, "expires": time.Now().Add(365 * 24 * time.Hour).UTC().Format(time.RFC3339),
		"keys": map[string]any{
			"k2": map[string]any{"alg": "ed25519", "pub": b64pub(t, newRootSigner)},
			"t1": map[string]any{"alg": "ed25519", "pub": b64pub(t, f.tsS)},
			"r1": map[string]any{"alg": "ed25519", "pub": b64pub(t, f.manS)},
		},
		"roles": map[string]any{
			"root":      map[string]any{"keyids": []string{"k2"}, "threshold": 1},
			"timestamp": map[string]any{"keyids": []string{"t1"}, "threshold": 1},
			"manifest":  map[string]any{"keyids": []string{f.srcRole}, "threshold": 1},
			"sources":   map[string]any{"keyids": []string{f.srcRole}, "threshold": 1},
		},
	}
	b2, _ := json.Marshal(root2)
	m.put("root.json", f.rootS.signEnv(b2, "k1")) // подпись СТАРЫМ k1

	res, err := c.Check(context.Background())
	if err != nil {
		t.Fatalf("ротация root: %v", err)
	}
	if res.Trust.Root().Version != 2 {
		t.Fatalf("root остался v%d", res.Trust.Root().Version)
	}
}

func TestThresholdEnforced(t *testing.T) {
	// Root с порогом 2 (k1,k2) — подпись только одним не проходит.
	s1, s2 := newSigner(t), newSigner(t)
	root := map[string]any{
		"type": "root", "version": 1, "expires": time.Now().Add(365 * 24 * time.Hour).UTC().Format(time.RFC3339),
		"keys": map[string]any{
			"k1": map[string]any{"alg": "ed25519", "pub": b64pub(t, s1)},
			"k2": map[string]any{"alg": "ed25519", "pub": b64pub(t, s2)},
		},
		"roles": map[string]any{"root": map[string]any{"keyids": []string{"k1", "k2"}, "threshold": 2}},
	}
	b, _ := json.Marshal(root)
	only1 := map[string]any{
		"signed":     json.RawMessage(b),
		"signatures": []any{map[string]any{"keyid": "k1", "sig": base64.StdEncoding.EncodeToString(ed25519.Sign(s1.priv, b))}},
	}
	one, _ := json.Marshal(only1)
	if _, err := NewTrust(one); err == nil {
		t.Fatal("threshold 2 не соблюдён: одна подпись принята")
	}
}

func TestDownloadArtifactShaAndLength(t *testing.T) {
	f := newFixture(t)
	m := &memSource{files: map[string][]byte{}}
	body := []byte("binary-content-here")
	sum := sha256.Sum256(body)
	man := map[string]any{
		"type": "manifest", "product": "lavray-windows", "channel": "stable",
		"serial": 7, "expires": time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339),
		"app": map[string]any{"version": "1.2.0", "minUpgradeFrom": "1.0.0",
			"assets": map[string]any{"windows-x64": map[string]any{
				"path": "v1.2.0/app.exe", "sha256": hex.EncodeToString(sum[:]), "length": len(body), "minisig": "x",
			}}},
		"core":    map[string]any{"version": "1.14.1-lav.1", "minApp": "1.2.0"},
		"presets": map[string]any{}, "geo": map[string]any{"path": "g", "sha256": strings.Repeat("a", 64), "length": 1},
		"notes": map[string]any{"ru": "n"}, "mandatory": false,
	}
	manB, _ := json.Marshal(man)
	m.put("manifest-stable.json", f.manS.signEnv(manB, "r1"))
	m.put("v1.2.0/app.exe", body)

	trust, err := NewTrust(f.rootJSON(t))
	if err != nil {
		t.Fatal(err)
	}
	c := &Client{Trust: trust, BootstrapSources: []Source{m}}
	if _, err := c.DownloadArtifact(context.Background(), m, mustParseManifest(t, f, manB), "windows-x64", 1<<20); err != nil {
		t.Fatalf("download ok-case: %v", err)
	}
	// Битая длина.
	m.put("v1.2.0/app.exe", append(body, 'x'))
	if _, err := c.DownloadArtifact(context.Background(), m, mustParseManifest(t, f, manB), "windows-x64", 1<<20); err == nil {
		t.Fatal("длина не сверена")
	}
	// Битый sha.
	bad := append([]byte(nil), body...)
	bad[0] ^= 0xff
	m.put("v1.2.0/app.exe", bad)
	if _, err := c.DownloadArtifact(context.Background(), m, mustParseManifest(t, f, manB), "windows-x64", 1<<20); err == nil {
		t.Fatal("sha256 не сверен")
	}
}

func mustParseManifest(t *testing.T, f fixture, signed []byte) *Manifest {
	t.Helper()
	env, err := ParseEnvelope(f.manS.signEnv(signed, "r1"))
	if err != nil {
		t.Fatal(err)
	}
	mf, err := ParseManifest(env.Signed)
	if err != nil {
		t.Fatal(err)
	}
	return mf
}
