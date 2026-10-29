// SPDX-License-Identifier: GPL-3.0-only

package buildtags

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

// Имена ассетов релиза задаёт release-windows.yml (первый шаг, переменные
// SETUP_NAME и PORTABLE_NAME); те же имена обязаны стоять в заметках релиза.
// Раньше workflow выпускал LAVRay_<ver>_x64-setup.exe и LAVRay-portable-x64.zip,
// заметки и README — другие имена, а в релизе лежали третьи (D1-08, F-113).
func TestReleaseAssetNamesAreTheSameInWorkflowAndNotes(t *testing.T) {
	root := repoRoot(t)
	var conf struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal([]byte(read(t, filepath.Join(root, "shell", "tauri.conf.json"))), &conf); err != nil || conf.Version == "" {
		t.Fatalf("shell/tauri.conf.json: нет version: %v", err)
	}
	setup := "LAVRay-" + conf.Version + "-x64-setup.exe"
	portable := "LAVRay-" + conf.Version + "-portable-x64.zip"

	notes := read(t, filepath.Join(root, "docs", "RELEASE-NOTES-windows-v"+conf.Version+".md"))
	for _, name := range []string{setup, portable, "SHA256SUMS.txt"} {
		if !strings.Contains(notes, name) {
			t.Errorf("в заметках релиза %s нет имени ассета %s", conf.Version, name)
		}
	}

	workflow := read(t, filepath.Join(root, ".github", "workflows", "release-windows.yml"))
	for _, want := range []string{`"SETUP_NAME=LAVRay-$ver-x64-setup.exe"`, `"PORTABLE_NAME=LAVRay-$ver-portable-x64.zip"`, "SHA256SUMS.txt"} {
		if !strings.Contains(workflow, want) {
			t.Errorf("release-windows.yml не задаёт ассет: нет %s", want)
		}
	}
	for _, old := range []string{"LAVRay-portable-x64.zip", "bundle/nsis/*.exe"} {
		if strings.Contains(workflow, old) {
			t.Errorf("release-windows.yml публикует ассет по старому имени %s", old)
		}
	}
}
