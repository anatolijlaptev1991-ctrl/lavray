package buildtags

import (
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// patchedForks — версии форка sing-box (как в replace файла go.mod), где
// проверен патч downloadZIP в experimental/clashapi/server_resources.go:
// отказ от «..», абсолютных путей и симлинков, лимит размера. Без патча
// sing-box при experimental.clash_api.external_ui_download_url пишет файлы
// из zip куда угодно (zip-slip, A1-11, F-034), поэтому, пока список пуст, тег
// with_clash_api в сборке запрещён. Чтобы разрешить его: пропатчить форк
// (с тестом на zip с «../x»), перепинить go.mod и дописать версию сюда.
var patchedForks = []string{}

const clashAPITag = "with_clash_api"

var forkVersion = regexp.MustCompile(`(?m)^replace\s+github\.com/sagernet/sing-box\s+=>\s+\S+\s+(\S+)\s*$`)

// mentionsClashAPI: тег записан вне строк-комментариев.
func mentionsClashAPI(text string) bool {
	for _, line := range strings.Split(text, "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "#") && strings.Contains(line, clashAPITag) {
			return true
		}
	}
	return false
}

func TestClashAPITagIsForbiddenUntilForkIsPatched(t *testing.T) {
	root := repoRoot(t)
	m := forkVersion.FindStringSubmatch(read(t, filepath.Join(root, "core", "go.mod")))
	if m == nil {
		t.Fatal("в core/go.mod нет replace для github.com/sagernet/sing-box: поправьте регулярное выражение forkVersion")
	}
	if slices.Contains(patchedForks, m[1]) {
		return
	}
	files, err := filepath.Glob(filepath.Join(root, ".github", "workflows", "*.yml"))
	if err != nil {
		t.Fatal(err)
	}
	files = append(files, filepath.Join(root, "core", "BUILD_TAGS"),
		filepath.Join(root, "shell", "build.ps1"), filepath.Join(root, "shell", "build.sh"))
	for _, path := range files {
		if mentionsClashAPI(read(t, path)) {
			rel, _ := filepath.Rel(root, path)
			t.Errorf("%s: тег %s запрещён, пока форк sing-box %s без патча downloadZIP (F-034); см. patchedForks",
				filepath.ToSlash(rel), clashAPITag, m[1])
		}
	}
}

func TestMentionsClashAPIDetector(t *testing.T) {
	for text, want := range map[string]bool{
		"singbox_run,with_quic,with_clash_api\n":              true,
		"go build -tags 'singbox_run with_clash_api' ./cmd/x": true,
		"  # раньше было with_clash_api — убрали":             false,
		"singbox_run,with_quic,with_gvisor,with_utls\n":       false,
	} {
		if got := mentionsClashAPI(text); got != want {
			t.Errorf("mentionsClashAPI(%q) = %v, ожидалось %v", text, got, want)
		}
	}
}
