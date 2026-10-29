// SPDX-License-Identifier: GPL-3.0-only

package buildtags

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Без этих тегов готовое ядро не работает: singbox_run — настоящий раннер,
// with_quic — hysteria2/TUIC, with_gvisor — стек TUN, with_utls — REALITY и fp=.
var required = []string{"singbox_run", "with_quic", "with_gvisor", "with_utls"}

// Файлы, которые собирают ядро и обязаны читать core/BUILD_TAGS.
var builders = []string{
	"shell/build.ps1", "shell/build.sh",
	".github/workflows/release-windows.yml", ".github/workflows/ci.yml",
}

// parseTags: одна строка, теги через запятую, без пробелов, пустых и повторов.
func parseTags(content string) ([]string, error) {
	line := strings.TrimRight(content, "\r\n")
	if line == "" || strings.ContainsAny(line, " \t\r\n") {
		return nil, fmt.Errorf("нужна одна непустая строка без пробелов: %q", content)
	}
	seen := map[string]bool{}
	tags := strings.Split(line, ",")
	for _, tag := range tags {
		if tag == "" || seen[tag] {
			return nil, fmt.Errorf("пустой или повторяющийся тег в %q", line)
		}
		seen[tag] = true
	}
	return tags, nil
}

var tagArg = regexp.MustCompile(`-tags[ =]+("[^"]*"|'[^']*'|[^\s"']+)`)

// literalTagArgs — значения -tags, где теги ядра записаны буквально
// (singbox_run, with_*). Комментарии пропускаются; singbox_check, $TAGS и
// "$(cat BUILD_TAGS)" допустимы.
func literalTagArgs(text string) []string {
	var found []string
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		for _, m := range tagArg.FindAllStringSubmatch(line, -1) {
			if strings.Contains(m[1], "singbox_run") || strings.Contains(m[1], "with_") {
				found = append(found, m[1])
			}
		}
	}
	return found
}

// repoRoot: тест лежит в core/internal/buildtags. Если ядро собирают отдельно
// от репозитория (нет shell/ и .github/), проверки пропускаются.
func repoRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{"shell", ".github"} {
		if _, err := os.Stat(filepath.Join(root, dir)); err != nil {
			t.Skipf("корень репозитория lavray не найден: %v", err)
		}
	}
	return root
}

func read(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestTagsFileHasRequiredTags(t *testing.T) {
	tags, err := parseTags(read(t, filepath.Join(repoRoot(t), "core", "BUILD_TAGS")))
	if err != nil {
		t.Fatal(err)
	}
	have := strings.Join(tags, ",")
	for _, need := range required {
		if !strings.Contains(","+have+",", ","+need+",") {
			t.Errorf("в core/BUILD_TAGS нет тега %q (сейчас: %s)", need, have)
		}
	}
	for _, bad := range []string{"", "\n", "a b", "a,,b", "a,", "a,a", "a\nb"} {
		if _, err := parseTags(bad); err == nil {
			t.Errorf("parseTags(%q) принял неверный файл", bad)
		}
	}
}

func TestLiteralTagDetector(t *testing.T) {
	bad := []string{
		`go build -tags 'singbox_run with_quic with_gvisor' -trimpath`, // build.ps1 до T-02
		`go build -tags "singbox_run with_quic" -o /tmp/lavray-core`,   // ci.yml до T-02
		`go test -tags singbox_run,with_quic ./internal/inst/`,
		`go build -tags=with_utls ./cmd/lavray-core/`,
	}
	good := []string{
		`go build -tags "$TAGS" -o /tmp/lavray-core`,
		`go build -tags $tags -trimpath -ldflags '-s -w'`,
		`go test -tags singbox_check ./internal/cfgbuild/`,
		`go test -tags "$(cat BUILD_TAGS)" ./internal/inst/`,
		`# go build -tags "singbox_run with_quic" — комментарий`,
	}
	for _, line := range bad {
		if len(literalTagArgs(line)) == 0 {
			t.Errorf("литерал не замечен: %s", line)
		}
	}
	for _, line := range good {
		if got := literalTagArgs(line); len(got) != 0 {
			t.Errorf("ложное срабатывание %v: %s", got, line)
		}
	}
}

func TestBuildersTakeTagsFromFile(t *testing.T) {
	root := repoRoot(t)
	for _, rel := range builders {
		if !strings.Contains(read(t, filepath.Join(root, filepath.FromSlash(rel))), "BUILD_TAGS") {
			t.Errorf("%s не читает core/BUILD_TAGS", rel)
		}
	}
	files, err := filepath.Glob(filepath.Join(root, ".github", "workflows", "*.yml"))
	if err != nil {
		t.Fatal(err)
	}
	files = append(files, filepath.Join(root, "shell", "build.ps1"), filepath.Join(root, "shell", "build.sh"))
	for _, path := range files {
		for _, arg := range literalTagArgs(read(t, path)) {
			rel, _ := filepath.Rel(root, path)
			t.Errorf("%s: теги записаны буквально (-tags %s); берите их из core/BUILD_TAGS", filepath.ToSlash(rel), arg)
		}
	}
}
