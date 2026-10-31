# SPDX-License-Identifier: GPL-3.0-only
"""Тесты scripts/size_ratchet.py: настоящий git-репозиторий во временном каталоге."""
import contextlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import size_ratchet  # noqa: E402


def lines(n: int) -> str:
    return "x\n" * n


class RatchetCase(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="size-ratchet-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        self.baseline = self.root / "scripts" / "size-ratchet.json"

    def put(self, rel: str, text: str) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")

    def set_baseline(self, data: dict[str, int]) -> None:
        self.put("scripts/size-ratchet.json", json.dumps(data))

    def run_main(self, *extra: str) -> tuple[int, str]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = size_ratchet.main(["--root", str(self.root), *extra])
        return code, out.getvalue()


class CheckTest(RatchetCase):
    def test_baseline_file_at_its_size_passes(self) -> None:
        self.put("core/big.go", lines(300))
        self.set_baseline({"core/big.go": 300})
        code, _ = self.run_main()
        self.assertEqual(code, 0)

    def test_baseline_file_grown_by_one_line_fails(self) -> None:
        self.put("core/big.go", lines(301))
        self.set_baseline({"core/big.go": 300})
        code, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("core/big.go: 301 строк, в baseline 300", out)

    def test_new_file_of_201_lines_fails(self) -> None:
        self.put("core/new.go", lines(201))
        self.set_baseline({})
        code, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("core/new.go: 201 строк", out)

    def test_new_file_of_200_lines_passes(self) -> None:
        self.put("core/new.go", lines(200))
        self.set_baseline({})
        code, _ = self.run_main()
        self.assertEqual(code, 0)

    def test_shrunk_file_passes_and_is_reported(self) -> None:
        self.put("core/big.go", lines(250))
        self.set_baseline({"core/big.go": 300})
        code, out = self.run_main()
        self.assertEqual(code, 0)
        self.assertIn("порог можно снизить", out)

    def test_deleted_file_is_reported_not_failed(self) -> None:
        self.put("core/other.go", lines(5))
        self.set_baseline({"core/gone.go": 300})
        code, out = self.run_main()
        self.assertEqual(code, 0)
        self.assertIn("core/gone.go: файла нет", out)

    def test_untracked_new_file_is_seen_but_gitignored_is_not(self) -> None:
        self.put(".gitignore", "ignored/\n")
        self.put("ignored/huge.go", lines(500))
        self.put("core/new.go", lines(201))
        self.set_baseline({})
        code, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertNotIn("ignored/huge.go", out)

    def test_excluded_paths_and_other_extensions_are_ignored(self) -> None:
        for rel in [
            "core/internal/gen/lavrayv1/lavray.pb.go",
            "ui/src/gen/lavray_pb.ts",
            "ui/src/lib/dictionaries/ru.ts",
            "core/internal/api/big_test.go",
            "ui/src/big.test.ts",
            "ui/src/big.test.tsx",
            "shell/tests/big.rs",
            "shell/src/coreproc/tests.rs",
            "core/internal/store/testdata/big.go",
            "scripts/tests/test_big.py",
            "ui/node_modules/pkg/index.ts",
            "shell/target/debug/build.rs",
            "ui/dist/assets/app.ts",
            "docs/big.md",
            "ui/package-lock.json",
        ]:
            self.put(rel, lines(500))
        self.set_baseline({})
        code, out = self.run_main()
        self.assertEqual(code, 0, out)
        self.assertIn("проверено 0 файлов", out)

    def test_only_shell_src_tests_rs_is_a_test_file(self) -> None:
        self.put("shell/src/tests.rs", lines(300))
        self.put("core/tests.rs", lines(300))  # вне shell/src — обычный код
        self.set_baseline({})
        code, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("core/tests.rs", out)
        self.assertNotIn("shell/src/tests.rs", out)

    def test_missing_or_broken_baseline_is_an_error(self) -> None:
        self.assertEqual(self.run_main()[0], 2)
        self.put("scripts/size-ratchet.json", "{not json")
        self.assertEqual(self.run_main()[0], 2)
        self.put("scripts/size-ratchet.json", '{"a.go": "300"}')
        self.assertEqual(self.run_main()[0], 2)


class WriteBaselineTest(RatchetCase):
    def test_round_trip(self) -> None:
        self.put("core/big.go", lines(250))
        self.put("ui/src/App.tsx", lines(201))
        self.put("core/small.go", lines(200))
        self.put("core/internal/gen/x.go", lines(900))

        code, _ = self.run_main("--write-baseline")
        self.assertEqual(code, 0)
        self.assertEqual(
            json.loads(self.baseline.read_text(encoding="utf-8")),
            {"core/big.go": 250, "ui/src/App.tsx": 201},
        )
        self.assertEqual(self.run_main()[0], 0)

        self.put("core/big.go", lines(251))
        self.assertEqual(self.run_main()[0], 1)

        # Пересборка принимает рост (изменение попадает в ревью как diff baseline).
        self.run_main("--write-baseline")
        self.assertEqual(json.loads(self.baseline.read_text(encoding="utf-8"))["core/big.go"], 251)
        self.assertEqual(self.run_main()[0], 0)

    def test_file_is_sorted_lf_and_stable(self) -> None:
        self.put("zeta.go", lines(210))
        self.put("alpha.go", lines(220))
        self.run_main("--write-baseline")
        first = self.baseline.read_bytes()
        self.run_main("--write-baseline")
        self.assertEqual(first, self.baseline.read_bytes())
        self.assertNotIn(b"\r", first)
        self.assertTrue(first.endswith(b"\n"))
        self.assertEqual(list(json.loads(first)), ["alpha.go", "zeta.go"])


class CountLinesTest(unittest.TestCase):
    def count(self, data: bytes) -> int:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "f.go"
            path.write_bytes(data)
            return size_ratchet.count_lines(path)

    def test_counts(self) -> None:
        self.assertEqual(self.count(b""), 0)
        self.assertEqual(self.count(b"a\n"), 1)
        self.assertEqual(self.count(b"a\nb"), 2)  # последняя строка без перевода строки
        self.assertEqual(self.count(b"a\r\nb\r\n"), 2)


if __name__ == "__main__":
    unittest.main()
