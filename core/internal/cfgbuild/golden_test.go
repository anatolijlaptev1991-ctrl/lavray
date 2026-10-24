package cfgbuild

// golden_test.go — golden-тесты конфигбилдера (§3.2, W4 = G01–G18).
//
// Вход: testdata/golden/Gxx.in.json (Profile + опционально Group /
// extra_profiles / settings / custom-поля). Эталон: Gxx.want.json —
// итоговый конфиг (2 пробела, ключи отсортированы). Обновление эталонов —
// только локально: `go test ./internal/cfgbuild -run TestGolden -update`.
//
// Дополнительно каждый эталон проверяется реальным sing-box (box.New) —
// тегированный TestGoldenSingBoxCheck в singboxcheck_lib_test.go:
// go test -tags singbox_check ./internal/cfgbuild/

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
)

var updateGolden = flag.Bool("update", false, "обновить golden-эталоны")

// goldenInput — вход golden-вектора.
type goldenInput struct {
	Profile       *model.Profile   `json:"profile"`
	Group         *model.Group     `json:"group,omitempty"`
	ExtraProfiles []*model.Profile `json:"extra_profiles,omitempty"`
	Settings      *BuildSettings   `json:"settings,omitempty"`
}

func loadGolden(t *testing.T) []string {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join("testdata", "golden", "G*.in.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) == 0 {
		t.Fatal("golden-фикстуры не найдены")
	}
	return paths
}

func TestGolden(t *testing.T) {
	for _, inPath := range loadGolden(t) {
		name := filepath.Base(inPath)
		t.Run(name, func(t *testing.T) {
			raw, err := os.ReadFile(inPath)
			if err != nil {
				t.Fatal(err)
			}
			var in goldenInput
			if err := json.Unmarshal(raw, &in); err != nil {
				t.Fatalf("in.json: %v", err)
			}
			if in.Profile == nil {
				t.Fatal("in.json: profile отсутствует")
			}
			pool := append([]*model.Profile{in.Profile}, in.ExtraProfiles...)
			res, err := Build(BuildRequest{
				Profile:  in.Profile,
				Group:    in.Group,
				Settings: in.Settings,
				Lookup:   lookupPool(pool...),
			})
			if err != nil {
				t.Fatalf("Build: %v", err)
			}
			got, err := MarshalIndent(res.Config)
			if err != nil {
				t.Fatal(err)
			}
			wantPath := filepath.Join("testdata", "golden", name[:len(name)-len(".in.json")]+".want.json")
			if *updateGolden {
				if err := os.WriteFile(wantPath, append(got, '\n'), 0o644); err != nil {
					t.Fatal(err)
				}
				return
			}
			want, err := os.ReadFile(wantPath)
			if err != nil {
				t.Fatalf("эталон не найден (запусти с -update): %v", err)
			}
			if string(want) != string(got)+"\n" {
				t.Fatalf("конфиг отличается от эталона %s:\n--- want ---\n%s\n--- got ---\n%s",
					filepath.Base(wantPath), want, got)
			}
		})
	}
}
