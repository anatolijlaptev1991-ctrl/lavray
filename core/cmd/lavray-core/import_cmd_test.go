// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
)

// nekoFixture — обезличенный каталог config NekoBox (тесты не читают настоящий).
var nekoFixture = filepath.Join("..", "..", "internal", "store", "nekoimport", "testdata", "nekobox", "config")

func tempData(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "lavray-import-cmd-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for i := 0; i < 50; i++ {
			if os.RemoveAll(dir) == nil {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	})
	return dir
}

type cmdReport struct {
	GroupsImported int            `json:"groups_imported"`
	ProfilesByType map[string]int `json:"profiles_by_type"`
	DryRun         bool           `json:"dry_run"`
	RoutesImported int            `json:"routes_imported"`
	Skipped        []struct{ File, Reason string }
}

// Настоящий бинарь: `import-nekobox --dry-run` печатает отчёт JSON и ничего не пишет (GC).
func TestImportNekoBoxCmdDryRun(t *testing.T) {
	exe := buildCore(t)
	data := filepath.Join(tempData(t), "data") // каталога данных ещё нет
	cmd := exec.Command(exe, "import-nekobox", "--data", data, "--from", nekoFixture, "--dry-run")
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("import-nekobox: %v\n%s", err, stderr.String())
	}
	var rep cmdReport
	if err := json.Unmarshal(stdout.Bytes(), &rep); err != nil {
		t.Fatalf("отчёт не JSON: %v\n%s", err, stdout.String())
	}
	if !rep.DryRun || rep.GroupsImported != 2 || rep.RoutesImported != 2 || len(rep.Skipped) != 2 {
		t.Errorf("отчёт: %+v", rep)
	}
	if n := 0; rep.ProfilesByType != nil {
		for _, c := range rep.ProfilesByType {
			n += c
		}
		if n != 7 {
			t.Errorf("профилей %d, ожидалось 7", n)
		}
	}
	if _, err := os.Stat(data); !os.IsNotExist(err) {
		t.Errorf("сухой прогон создал каталог данных: %v", err)
	}
}

// Настоящий перенос пишет в базу, повторный — «уже перенесено».
func TestImportNekoBoxCmdWrites(t *testing.T) {
	data := tempData(t)
	var out, errOut bytes.Buffer
	args := []string{"--data", data, "--from", nekoFixture}
	if code := runImportNekoBox(args, &out, &errOut); code != 0 {
		t.Fatalf("код %d: %s", code, errOut.String())
	}
	var rep cmdReport
	if err := json.Unmarshal(out.Bytes(), &rep); err != nil || rep.DryRun || rep.GroupsImported != 2 {
		t.Fatalf("отчёт: %+v %v", rep, err)
	}
	st, err := store.Open(data)
	if err != nil {
		t.Fatal(err)
	}
	groups, _ := st.ListGroups()
	_ = st.Close()
	if len(groups) != 3 { // Default + 2 группы NekoBox
		t.Errorf("групп %d, ожидалось 3", len(groups))
	}
	out.Reset()
	if code := runImportNekoBox(append(args, "--no-routes", "--no-settings"), &out, &errOut); code != 0 {
		t.Fatalf("повторный перенос: код %d: %s", code, errOut.String())
	}
	var again cmdReport
	if err := json.Unmarshal(out.Bytes(), &again); err != nil || again.GroupsImported != 0 || len(again.ProfilesByType) != 0 {
		t.Errorf("повторный перенос создал записи: %+v %v", again, err)
	}
}

func TestImportNekoBoxCmdErrors(t *testing.T) {
	data := tempData(t)
	cases := []struct {
		name string
		args []string
		code int
		msg  string
	}{
		{"нет --from", []string{"--data", data}, 2, "--from"},
		{"неизвестный флаг", []string{"--data", data, "--bogus"}, 2, ""},
		{"нет каталога", []string{"--data", data, "--from", filepath.Join(data, "нет")}, 1, "не найден"},
		{"не каталог NekoBox", []string{"--data", data, "--from", data}, 1, "ни groups, ни profiles"},
		{"лишний аргумент", []string{"--data", data, "--from", nekoFixture, "extra"}, 2, ""},
	}
	for _, c := range cases {
		var out, errOut bytes.Buffer
		if code := runImportNekoBox(c.args, &out, io.MultiWriter(&errOut)); code != c.code {
			t.Errorf("%s: код %d, ожидался %d (%s)", c.name, code, c.code, errOut.String())
		}
		if c.msg != "" && !strings.Contains(errOut.String(), c.msg) {
			t.Errorf("%s: в stderr нет %q: %s", c.name, c.msg, errOut.String())
		}
		if out.Len() != 0 {
			t.Errorf("%s: в stdout попал мусор: %s", c.name, out.String())
		}
	}
}

func TestRunSubcommandDispatch(t *testing.T) {
	if _, ok := runSubcommand([]string{"lavray-core"}, nil, nil, nil); ok {
		t.Error("без аргументов подкоманда не распознана")
	}
	if _, ok := runSubcommand([]string{"lavray-core", "serve"}, nil, nil, nil); ok {
		t.Error("serve не подкоманда runSubcommand")
	}
	var errOut bytes.Buffer
	if code, ok := runSubcommand([]string{"lavray-core", "import-nekobox"}, nil, io.Discard, &errOut); !ok || code != 2 {
		t.Errorf("import-nekobox без флагов: %d %v", code, ok)
	}
	printUsage(&errOut)
	if !strings.Contains(errOut.String(), "import-nekobox") {
		t.Error("справка не упоминает import-nekobox")
	}
}
