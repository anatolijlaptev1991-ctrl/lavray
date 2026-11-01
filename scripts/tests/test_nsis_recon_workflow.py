# SPDX-License-Identifier: GPL-3.0-only
"""Workflow nsis-recon (Ф3.0, разведка NSIS на одноразовом раннере) и его скрипт.

Проверяется то, что нельзя ломать: запуск только вручную, ввод не попадает в `run:`,
права только на чтение, срок у каждого задания, скрипт и его модули существуют,
GH_TOKEN виден только шагу скачивания, а сам скрипт отказывается работать вне раннера.
Обязательные проверки используют только стандартную библиотеку (как test_signing_workflows);
разбор настоящим YAML и синтаксис PowerShell проверяются, если PyYAML и pwsh есть в системе.
"""
import os
import re
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_signing_workflows import UNTRUSTED, job_text, run_scripts, steps  # noqa: E402

try:
    import yaml
except ImportError:  # в CI пакеты не ставятся
    yaml = None

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "nsis-recon.yml"
SCRIPT = ROOT / "scripts" / "release" / "nsis_recon.ps1"
LIB_DIR = ROOT / "scripts" / "release" / "nsis_recon"
TEXT = WORKFLOW.read_text(encoding="utf-8")


def top_level_block(text: str, key: str) -> str:
    match = re.search(rf"^{key}:\n((?:[ \t]+.*\n|\n)*)", text, re.M)
    if match is None:
        raise AssertionError(f"нет верхнего ключа {key}")
    return match.group(1)


def step_named(job: str, fragment: str) -> str:
    for name, body in steps(job).items():
        if fragment in name:
            return body
    raise AssertionError(f"нет шага «{fragment}»")


def ps_files() -> list:
    return [SCRIPT, *sorted(LIB_DIR.glob("*.ps1"))]


class Trigger(unittest.TestCase):
    def test_only_workflow_dispatch(self):
        keys = re.findall(r"^  ([A-Za-z_]+):\s*$", top_level_block(TEXT, "on"), re.M)
        self.assertEqual(keys, ["workflow_dispatch"])
        for forbidden in ("push:", "pull_request", "schedule:", "cron:", "workflow_run", "workflow_call"):
            self.assertNotIn(forbidden, TEXT, forbidden)

    def test_inputs_old_and_new_have_the_documented_defaults(self):
        block = top_level_block(TEXT, "on")
        self.assertRegex(block, r'\n      old:\n(?:        .*\n)*?        default: "0\.3\.0"')
        self.assertRegex(block, r'\n      new:\n(?:        .*\n)*?        default: "0\.9\.0"')


class Safety(unittest.TestCase):
    def test_permissions_are_read_only(self):
        self.assertRegex(TEXT, re.compile(r"^permissions:\n  contents: read\n", re.M))
        self.assertNotRegex(TEXT, r":\s*write\b")

    def test_no_secrets_are_used(self):
        self.assertNotIn("secrets.", TEXT)

    def test_every_job_has_a_timeout(self):
        for job in ("validate", "recon"):
            match = re.search(r"^    timeout-minutes: (\d+)$", job_text(WORKFLOW, job), re.M)
            self.assertIsNotNone(match, f"у задания {job} нет timeout-minutes")
            self.assertLessEqual(int(match.group(1)), 90, job)

    def test_untrusted_context_never_appears_inside_run_scripts(self):
        for line, script in run_scripts(TEXT):
            self.assertIsNone(UNTRUSTED.search(script), f"строка {line}: недоверенный контекст внутри run")
            self.assertNotIn("${{", script, f"строка {line}: выражение внутри run")

    def test_input_is_validated_in_a_job_without_secrets_and_reaches_recon_only_as_output(self):
        validate = job_text(WORKFLOW, "validate")
        self.assertIn("^[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}", validate)
        self.assertIn("OLD: ${{ inputs.old }}", validate)
        self.assertIn("NEW: ${{ inputs.new }}", validate)
        recon = job_text(WORKFLOW, "recon")
        self.assertNotIn("inputs.", recon, "recon берёт версии только из выхода validate")
        self.assertIn("needs: validate", recon)
        self.assertIn("needs.validate.outputs.old", recon)
        self.assertIn("needs.validate.outputs.new", recon)

    def test_gh_token_is_visible_only_to_the_download_step(self):
        recon = job_text(WORKFLOW, "recon")
        holders = [name for name, body in steps(recon).items() if "GH_TOKEN" in body]
        self.assertEqual(len(holders), 1, holders)
        self.assertIn("Скачивание", holders[0])
        self.assertIn("GH_TOKEN: ${{ github.token }}", step_named(recon, "Скачивание"))
        self.assertNotIn("GH_TOKEN", step_named(recon, "Разведка NSIS"))

    def test_checkout_does_not_keep_credentials(self):
        self.assertIn("persist-credentials: false", job_text(WORKFLOW, "recon"))


class Recon(unittest.TestCase):
    def setUp(self):
        self.recon = job_text(WORKFLOW, "recon")

    def test_runs_on_windows_2025(self):
        self.assertRegex(self.recon, r"runs-on: windows-2025\n")

    def test_downloads_real_releases_and_verifies_sha256sums(self):
        download = step_named(self.recon, "Скачивание")
        self.assertIn("gh release download", download)
        self.assertIn("anatolijlaptev1991-ctrl/lavray-windows", download)
        self.assertIn("SHA256SUMS.txt", download)
        self.assertIn("Get-FileHash", download)
        self.assertRegex(download, r"if \(\$got -ne \$want\) \{ throw")

    def test_runs_the_script_and_uploads_json_and_log_as_artifact(self):
        run = step_named(self.recon, "Разведка NSIS")
        self.assertIn("./scripts/release/nsis_recon.ps1", run)
        self.assertIn("-OutDir recon-out", run)
        upload = step_named(self.recon, "Артефакт")
        self.assertIn("actions/upload-artifact@v4", upload)
        self.assertIn("if: always()", upload)
        self.assertIn("name: nsis-recon", upload)
        self.assertIn("path: recon-out/", upload)

    def test_script_path_from_the_workflow_exists(self):
        for path in re.findall(r"\./(scripts/[\w./-]+\.ps1)", TEXT):
            self.assertTrue((ROOT / path).is_file(), path)


class Script(unittest.TestCase):
    def setUp(self):
        self.text = SCRIPT.read_text(encoding="utf-8")

    def test_script_and_all_dot_sourced_modules_exist(self):
        listed = re.search(r"foreach \(\$lib in (.+?)\) \{", self.text)
        self.assertIsNotNone(listed)
        libs = re.findall(r"'(\w+)'", listed.group(1))
        self.assertGreaterEqual(len(libs), 8)
        for lib in libs:
            self.assertTrue((LIB_DIR / f"{lib}.ps1").is_file(), lib)
        self.assertEqual(sorted(libs), sorted(p.stem for p in LIB_DIR.glob("*.ps1")), "модуль не подключён или лишний")

    def test_seven_scenarios_run_through_the_guarded_runner(self):
        found = re.findall(r"^Invoke-Scenario 's(\d)_(\w+)' (\d+) \{", self.text, re.M)
        self.assertEqual([n for n, _, _ in found], list("1234567"))
        for _, _, timeout in found:
            self.assertLessEqual(int(timeout), 1800)
        common = (LIB_DIR / "common.ps1").read_text(encoding="utf-8")
        body = common.split("function Invoke-Scenario", 1)[1].split("\nfunction ", 1)[0]
        for fragment in ("try {", "catch {", "status = 'error'", "$script:Deadline"):
            self.assertIn(fragment, body)

    def test_refuses_to_run_outside_a_github_hosted_runner(self):
        self.assertRegex(self.text, r"GITHUB_ACTIONS -ne 'true' -or \$env:RUNNER_ENVIRONMENT -ne 'github-hosted'")
        guard = self.text.index("GITHUB_ACTIONS")
        self.assertLess(guard, self.text.index("foreach ($lib in"), "защита раньше подключения модулей")
        self.assertIn("exit 3", self.text)

    def test_bare_exe_scenario_cannot_trigger_a_rollback_install(self):
        # watchdog откатывается только прошлым установщиком из <data>/updates/previous: каталог данных
        # здесь свежий и пустой, а флагов, разрешающих старшую версию, сценарий не передаёт.
        bare = (LIB_DIR / "scenarios_bare.ps1").read_text(encoding="utf-8")
        self.assertIn("'--update-watchdog'", bare)
        self.assertNotIn("--allow-older", bare)
        self.assertIn("$data = Join-Path $Dir 'data'", bare)
        self.assertIn('"--data-dir=$data"', bare)

    def test_files_have_spdx_and_lf_endings(self):
        for path in ps_files():
            data = path.read_bytes()
            self.assertNotIn(b"\r\n", data, f"{path.name}: CRLF")
            self.assertFalse(data.startswith(b"\xef\xbb\xbf"), f"{path.name}: BOM")
            head = data.decode("utf-8").splitlines()[:3]
            self.assertTrue(any("SPDX-License-Identifier: GPL-3.0-only" in line for line in head), path.name)

    def test_functions_stay_within_fifty_lines(self):
        for path in ps_files():
            lines = path.read_text(encoding="utf-8").splitlines()
            start = None
            for i, line in enumerate(lines):
                if line.startswith("function "):
                    start = i
                elif line == "}" and start is not None:
                    self.assertLessEqual(i - start + 1, 50, f"{path.name}:{start + 1}")
                    start = None


class Parsers(unittest.TestCase):
    @unittest.skipIf(yaml is None, "PyYAML не установлен")
    def test_workflow_is_valid_yaml_with_the_expected_shape(self):
        doc = yaml.safe_load(TEXT)
        triggers = doc.get("on", doc.get(True))  # PyYAML читает ключ `on` как True
        self.assertEqual(list(triggers), ["workflow_dispatch"])
        self.assertEqual(doc["permissions"], {"contents": "read"})
        self.assertEqual(set(doc["jobs"]), {"validate", "recon"})
        for name, job in doc["jobs"].items():
            self.assertIsInstance(job["timeout-minutes"], int, name)
        self.assertEqual(doc["jobs"]["recon"]["runs-on"], "windows-2025")
        self.assertEqual(doc["jobs"]["recon"]["needs"], "validate")

    @unittest.skipUnless(shutil.which("pwsh") or shutil.which("powershell"), "нет PowerShell")
    def test_powershell_sources_parse_without_errors(self):
        shell = shutil.which("pwsh") or shutil.which("powershell")
        code = (
            "$bad = 0; foreach ($f in $env:RECON_PS1 -split '\\|') { $t = $null; $e = $null; "
            "[void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$t, [ref]$e); "
            "foreach ($x in $e) { Write-Output ('{0}:{1}: {2}' -f $f, $x.Extent.StartLineNumber, $x.Message); $bad++ } }; "
            "exit $(if ($bad) { 1 } else { 0 })"
        )
        env = dict(os.environ, RECON_PS1="|".join(str(p) for p in ps_files()))
        done = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-Command", code], env=env, capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)


if __name__ == "__main__":
    unittest.main()
