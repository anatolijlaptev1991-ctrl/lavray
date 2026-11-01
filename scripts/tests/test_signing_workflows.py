# SPDX-License-Identifier: GPL-3.0-only
"""Ключи подписи обновлений в workflow (T-75): каждый ключ виден только своему шагу,
токен не в адресе remote, у выпуска и продления общий замок. Только стандартная
библиотека: YAML не разбирается, шаги режутся по строкам `- name:`."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
SECRET = re.compile(r"secrets\.(LAVRAY_[A-Z]+_KEY)\b")
# Значение секрета в env шага (а не булево `!= ''` для вентиля).
SECRET_VALUE = re.compile(r":\s*\$\{\{\s*secrets\.(LAVRAY_[A-Z]+_KEY)\s*\}\}\s*$")


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


class SigningWorkflows(unittest.TestCase):
    def setUp(self):
        self.release = WORKFLOWS / "release-windows.yml"
        self.sign = job_text(self.release, "sign")

    def test_no_signing_key_at_job_level(self):
        header = self.sign.split("    steps:")[0]
        self.assertNotRegex(header, SECRET_VALUE.pattern.replace(r"\s*$", ""), "ключ в env задания sign")
        self.assertEqual(secret_values(header), set())

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
        self.assertIn("github.event.repository.default_branch", text)
        self.assertIn("updsign expiry", text)
        self.assertIn("336h", text)  # 14 суток до истечения манифеста

    def test_meta_resign_is_reviewed_and_tag_only(self):
        text = (WORKFLOWS / "meta-resign.yml").read_text(encoding="utf-8")
        self.assertIn("environment: release-signing", text)
        self.assertIn("workflow_dispatch", text)
        self.assertIn("startsWith(github.ref, 'refs/tags/v')", text)
        self.assertNotIn("LAVRAY_ARTIFACT_KEY", text, "продление манифеста не требует ключа установщика")


if __name__ == "__main__":
    unittest.main()
