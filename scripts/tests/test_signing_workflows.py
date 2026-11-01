# SPDX-License-Identifier: GPL-3.0-only
"""Ключи подписи обновлений в workflow (T-75): каждый ключ виден только своему шагу,
токен не в адресе remote, у выпуска и продления общий замок, ввод workflow не попадает
в текст скриптов, а свежесть timestamp продлевается раньше любых проверок каналов.
Только стандартная библиотека: YAML не разбирается, шаги режутся по строкам `- name:`."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
SECRET = re.compile(r"secrets\.(LAVRAY_[A-Z]+_KEY)\b")
# Значение секрета в env шага (а не булево `!= ''` для вентиля).
SECRET_VALUE = re.compile(r":\s*\$\{\{\s*secrets\.(LAVRAY_[A-Z]+_KEY)\s*\}\}\s*$")
# Недоверенный контекст: ввод workflow_dispatch, тело события, имена веток.
UNTRUSTED = re.compile(r"\$\{\{[^}]*\b(inputs\.|github\.event|github\.head_ref|github\.base_ref)", re.S)


def job_text(path: Path, job: str) -> str:
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"^  {job}:\n(.*?)(?=^  [A-Za-z_-]+:\n|\Z)", text, re.S | re.M)
    if match is None:
        raise AssertionError(f"нет задания {job} в {path.name}")
    return match.group(1)


def steps(job: str) -> dict:
    parts = re.split(r"^      - ", job, flags=re.M)[1:]
    out = {}
    for part in parts:
        name = re.search(r'name:\s*"?([^"\n]+)', part)
        out[name.group(1) if name else part[:30]] = part
    return out


def secret_values(step: str) -> set:
    return {m.group(1) for line in step.splitlines() if (m := SECRET_VALUE.search(line))}


def run_scripts(text: str):
    """Тела `run:` (блочные и однострочные): (номер строки, текст)."""
    lines = text.splitlines()
    found = []
    i = 0
    while i < len(lines):
        m = re.match(r"^(\s*)(?:- )?run:\s*(.*)$", lines[i])
        if m is None:
            i += 1
            continue
        indent, rest = len(m.group(1)), m.group(2).strip()
        if rest.startswith(("|", ">")):
            body = []
            j = i + 1
            while j < len(lines) and (not lines[j].strip() or len(lines[j]) - len(lines[j].lstrip()) > indent):
                body.append(lines[j])
                j += 1
            found.append((i + 1, "\n".join(body)))
            i = j
        else:
            found.append((i + 1, rest))
            i += 1
    return found


class SigningWorkflows(unittest.TestCase):
    def setUp(self):
        self.release = WORKFLOWS / "release-windows.yml"
        self.sign = job_text(self.release, "sign")

    def test_no_signing_key_at_job_level(self):
        header = self.sign.split("    steps:")[0]
        self.assertEqual(secret_values(header), set(), "ключ в env задания sign")

    def test_each_key_is_visible_only_to_its_own_step(self):
        want = {
            "Подпись манифеста (ключи manifest и artifact)": {"LAVRAY_MANIFEST_KEY", "LAVRAY_ARTIFACT_KEY"},
            "Подпись sources.json (ключ manifest)": {"LAVRAY_MANIFEST_KEY"},
            "Подпись timestamp.json (ключ timestamp)": {"LAVRAY_TIMESTAMP_KEY"},
            "Подпись установщика .minisig (ключ artifact)": {"LAVRAY_ARTIFACT_KEY"},
        }
        found = {name: secret_values(body) for name, body in steps(self.sign).items()}
        for name, keys in want.items():
            self.assertEqual(found.get(name), keys, name)
        for name, keys in found.items():
            if name not in want:
                self.assertEqual(keys, set(), f"шаг «{name}» видит ключ подписи")

    def test_gate_receives_booleans_not_secret_values(self):
        gate = steps(self.sign)["Ключи подписи заданы?"]
        self.assertEqual(secret_values(gate), set())
        self.assertIn("secrets.LAVRAY_TIMESTAMP_KEY != ''", gate)

    def test_release_signing_has_a_concurrency_group_and_tag_only(self):
        self.assertRegex(self.sign, r"concurrency:\s*\n\s+group: release-signing")
        self.assertIn("startsWith(github.ref, 'refs/tags/v')", self.sign)

    def test_token_goes_in_an_extraheader_not_in_the_remote_url(self):
        for name in ("release-windows.yml", "meta-refresh.yml", "meta-resign.yml"):
            text = (WORKFLOWS / name).read_text(encoding="utf-8")
            self.assertNotRegex(text, r"https://x-access-token", name)
            self.assertIn("http.extraheader", text, name)

    def test_manifest_refuses_a_version_not_newer_than_published(self):
        self.assertIn("-published-dir pages/meta", self.sign)
        self.assertRegex(self.sign, r'updsign verify .*-channel "\$CHANNEL"')


class FreshnessWorkflows(unittest.TestCase):
    def test_meta_refresh_holds_only_the_timestamp_key(self):
        text = (WORKFLOWS / "meta-refresh.yml").read_text(encoding="utf-8")
        self.assertIn("environment: release-timestamp", text)
        self.assertEqual(set(SECRET.findall(text)), {"LAVRAY_TIMESTAMP_KEY"})
        self.assertIn("cron:", text)
        self.assertIn("updsign expiry", text)
        self.assertIn("336h", text)  # 14 суток до истечения манифеста

    def test_meta_resign_is_reviewed_and_tag_only(self):
        text = (WORKFLOWS / "meta-resign.yml").read_text(encoding="utf-8")
        self.assertIn("environment: release-signing", text)
        self.assertIn("workflow_dispatch", text)
        self.assertIn("startsWith(github.ref, 'refs/tags/v')", text)
        self.assertNotIn("LAVRAY_ARTIFACT_KEY", text, "продление манифеста не требует ключа установщика")


class NoInjection(unittest.TestCase):
    def test_untrusted_context_never_appears_inside_run_scripts(self):
        # Ввод workflow_dispatch, тело события, имя ветки — только через env, не в тексте скрипта.
        for path in sorted(WORKFLOWS.glob("*.yml")):
            for line, script in run_scripts(path.read_text(encoding="utf-8")):
                self.assertIsNone(UNTRUSTED.search(script), f"{path.name}:{line}: недоверенный контекст внутри run")

    def test_meta_resign_validates_days_in_a_job_without_secrets(self):
        path = WORKFLOWS / "meta-resign.yml"
        validate = job_text(path, "validate")
        check = next((body for name, body in steps(validate).items() if name.startswith("Проверка срока")), None)
        self.assertIsNotNone(check, "нет шага «Проверка срока …»")
        header = validate.split("    steps:")[0]
        self.assertNotIn("environment:", header, "проверка идёт до ревью и без Environment")
        self.assertNotIn("secrets.", validate, "проверка срока не должна видеть секреты")
        self.assertIn("^[0-9]{1,4}$", check)
        self.assertIn("inputs.days", check)  # ввод приходит в env шага, не в скрипт
        resign = job_text(path, "resign")
        self.assertIn("needs: validate", resign)
        for name, body in steps(resign).items():
            self.assertNotIn("DAYS", body, f"шаг «{name}» использует сырой ввод DAYS")
            self.assertNotRegex(body, r"\$\(\(", f"шаг «{name}» считает арифметику над строкой")
        self.assertIn("needs.validate.outputs.hours", resign)


class RefreshOrder(unittest.TestCase):
    def setUp(self):
        path = WORKFLOWS / "meta-refresh.yml"
        self.text = path.read_text(encoding="utf-8")
        self.steps = list(steps(job_text(path, "refresh")).items())

    def index(self, fragment):
        for i, (name, _) in enumerate(self.steps):
            if fragment in name:
                return i
        self.fail(f"нет шага «{fragment}»")

    def test_runs_only_on_main(self):
        self.assertIn("if: github.ref == 'refs/heads/main'", self.text)
        self.assertNotIn("default_branch", self.text)

    def test_timestamp_is_published_before_per_channel_checks(self):
        sign = self.index("Подпись timestamp.json")
        first_check = self.index("Проверка timestamp")
        publish = self.index("Публикация timestamp.json")
        per_channel = self.index("Манифесты по каналам")
        expiry = self.index("Манифесты и sources: срок")
        self.assertLess(sign, first_check)
        self.assertLess(first_check, publish)
        self.assertLess(publish, per_channel)
        self.assertLess(per_channel, expiry)
        before = self.steps[first_check][1]
        self.assertIn("-role timestamp", before)
        self.assertNotIn("-channel", before, "до публикации каналы не проверяются")


if __name__ == "__main__":
    unittest.main()
