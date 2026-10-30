# SPDX-License-Identifier: GPL-3.0-only
"""Тесты scripts/covergate.py: профили Go и lcov, пороги, отчёт и коды выхода."""
import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import covergate  # noqa: E402

MODULE = covergate.GO_MODULE_PREFIX


def go_profile(*blocks: tuple[str, int, int]) -> str:
    """Профиль Go из блоков (файл, операторов, счётчик); у каждого блока свой диапазон."""
    rows = [f"{MODULE}{name}:{i + 1}.1,{i + 1}.20 {stmts} {count}" for i, (name, stmts, count) in enumerate(blocks)]
    return "mode: set\n" + "\n".join(rows) + "\n"


def lcov(name: str, hits: list[int]) -> str:
    das = "".join(f"DA:{i + 1},{h}\n" for i, h in enumerate(hits))
    return f"TN:\nSF:{name}\n{das}LF:{len(hits)}\nLH:{sum(1 for h in hits if h > 0)}\nend_of_record\n"


class GateCase(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="covergate-"))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)

    def write(self, name: str, text: str) -> str:
        path = self.dir / name
        path.write_text(text, encoding="utf-8", newline="\n")
        return str(path)

    def run_gate(self, config: str, *args: str) -> tuple[int, str]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = covergate.main(["--config", self.write("coverage.yaml", config), "--root", str(self.dir), *args])
        return code, out.getvalue()


class ThresholdTest(GateCase):
    def test_exact_threshold_passes(self) -> None:
        # 900 из 1000 операторов = ровно 90 %.
        prof = self.write("c.out", go_profile(("core/a/x.go", 900, 1), ("core/a/y.go", 100, 0)))
        code, out = self.run_gate("thresholds:\n  core/a/: 90\n", "--go", prof)
        self.assertEqual(code, 0, out)
        self.assertIn("90.00%", out)

    def test_one_tenth_below_threshold_fails(self) -> None:
        # 899 из 1000 = 89.9 % при пороге 90.
        prof = self.write("c.out", go_profile(("core/a/x.go", 899, 1), ("core/a/y.go", 101, 0)))
        code, out = self.run_gate("thresholds:\n  core/a/: 90\n", "--go", prof)
        self.assertEqual(code, 1)
        self.assertIn("НИЖЕ ПОРОГА", out)
        self.assertIn("core/a/: 89.90% при пороге 90%", out)
        self.assertIn("(899/1000", out)

    def test_fractional_threshold(self) -> None:
        prof = self.write("c.out", go_profile(("core/a/x.go", 171, 1), ("core/a/y.go", 29, 0)))
        self.assertEqual(self.run_gate("thresholds:\n  core/a/: 85.5\n", "--go", prof)[0], 0)
        self.assertEqual(self.run_gate("thresholds:\n  core/a/: 85.6\n", "--go", prof)[0], 1)

    def test_prefix_missing_from_profile_is_an_error(self) -> None:
        prof = self.write("c.out", go_profile(("core/a/x.go", 10, 1)))
        code, out = self.run_gate("thresholds:\n  core/a/: 50\n  core/missing/: 10\n", "--go", prof)
        self.assertEqual(code, 1)
        self.assertIn("НЕТ ДАННЫХ  core/missing/", out)
        self.assertIn("ok", out)  # остальные записи всё равно проверены

    def test_only_limits_which_entries_are_checked(self) -> None:
        prof = self.write("c.out", go_profile(("core/a/x.go", 10, 1)))
        config = "thresholds:\n  core/a/: 50\n  ui/src/lib/: 90\n"
        self.assertEqual(self.run_gate(config, "--go", prof)[0], 1)
        self.assertEqual(self.run_gate(config, "--go", prof, "--only", "core/")[0], 0)

    def test_empty_config_has_nothing_to_check(self) -> None:
        code, out = self.run_gate("thresholds: {}\n")
        self.assertEqual(code, 0)
        self.assertIn("проверять нечего", out)


class ProfileFormatTest(GateCase):
    def test_both_formats_in_one_run(self) -> None:
        go = self.write("c.out", go_profile(("core/a/x.go", 4, 1), ("core/a/y.go", 1, 0)))  # 80 %
        web = self.write("lcov.info", lcov("src/lib/f.ts", [1, 1, 0, 3]))  # 75 %
        config = "thresholds:\n  core/a/: 80\n  ui/src/lib/: 75\n"
        code, out = self.run_gate(config, "--go", go, "--lcov", web + "=ui/")
        self.assertEqual(code, 0, out)
        self.assertIn("core/a/: 80.00%", out)
        self.assertIn("ui/src/lib/: 75.00%", out)
        # Порог на полпроцента выше фактического ловится в каждом формате.
        self.assertEqual(self.run_gate("thresholds:\n  core/a/: 80.5\n", "--go", go)[0], 1)
        self.assertEqual(self.run_gate("thresholds:\n  ui/src/lib/: 75.5\n", "--lcov", web + "=ui/")[0], 1)

    def test_go_blocks_repeated_across_profiles_are_merged(self) -> None:
        # Один и тот же блок в двух профилях (разные пакеты тестов): покрыт, если покрыт хоть раз.
        a = self.write("a.out", go_profile(("core/a/x.go", 10, 0)))
        b = self.write("b.out", go_profile(("core/a/x.go", 10, 7)))
        code, out = self.run_gate("thresholds:\n  core/a/x.go: 100\n", "--go", a, "--go", b)
        self.assertEqual(code, 0, out)
        self.assertIn("(10/10", out)

    def test_go_count_mode_zero_is_uncovered(self) -> None:
        text = f"mode: atomic\n{MODULE}core/a/x.go:1.1,2.2 3 0\n{MODULE}core/a/x.go:3.1,4.2 1 5\n"
        code, out = self.run_gate("thresholds:\n  core/a/: 25\n", "--go", self.write("c.out", text))
        self.assertEqual(code, 0, out)
        self.assertIn("(1/4", out)

    def test_lcov_absolute_paths_inside_root_become_relative(self) -> None:
        sf = f"{self.dir.resolve().as_posix()}/shell/src/main.rs"
        prof = self.write("shell.info", lcov(sf, [1, 0]))
        code, out = self.run_gate("thresholds:\n  shell/src/: 50\n", "--lcov", prof)
        self.assertEqual(code, 0, out)

    def test_lcov_repeated_records_are_merged(self) -> None:
        text = lcov("src/a.ts", [0, 0, 1]) + lcov("src/a.ts", [1, 0, 0])
        prof = self.write("l.info", text) + "=ui/"
        code, out = self.run_gate("thresholds:\n  ui/src/: 66\n", "--lcov", prof)
        self.assertEqual(code, 0, out)  # покрыты строки 1 и 3 из 3 = 66.67 %, не 33 %
        self.assertIn("(2/3", out)
        self.assertEqual(self.run_gate("thresholds:\n  ui/src/: 67\n", "--lcov", prof)[0], 1)

    def test_lcov_without_lines_is_no_data(self) -> None:
        text = "SF:src/empty.ts\nend_of_record\n"
        code, out = self.run_gate("thresholds:\n  ui/src/: 1\n", "--lcov", self.write("l.info", text) + "=ui/")
        self.assertEqual(code, 1)
        self.assertIn("НЕТ ДАННЫХ", out)


class InputErrorTest(GateCase):
    def test_broken_inputs_exit_with_2(self) -> None:
        good = self.write("c.out", go_profile(("core/a/x.go", 1, 1)))
        cases = [
            ("thresholds:\n  core/a/: 90\n", ["--go", self.write("bad.out", "no mode line\n")]),
            ("thresholds:\n  core/a/: 90\n", ["--go", self.write("bad2.out", "mode: set\nnot a block\n")]),
            ("thresholds:\n  core/a/: 90\n", ["--go", str(self.dir / "absent.out")]),
            ("thresholds:\n  core/a/: 90\n", ["--lcov", self.write("bad.info", "DA:1,1\n")]),
            ("thresholds:\n  core/a/: 101\n", ["--go", good]),
            ("thresholds:\n  core/a/: high\n", ["--go", good]),
            ("thresholds:\n  core/a/: 1\n  core/a/: 2\n", ["--go", good]),
            ("core/a/: 90\n", ["--go", good]),
            ("  core/a/: 90\n", ["--go", good]),
        ]
        for config, args in cases:
            with self.subTest(config=config, args=args):
                self.assertEqual(self.run_gate(config, *args)[0], 2)


class ConfigParseTest(unittest.TestCase):
    def test_subset(self) -> None:
        text = (
            "# заголовок\n\nthresholds:   # раздел\n"
            "  core/a/: 90   # каталог\n"
            "  # строка-комментарий\n"
            "  'ui/src/x.ts': 87.5\n"
            '  "shell/": 0\n'
        )
        self.assertEqual(
            covergate.parse_config(text),
            {"core/a/": Fraction(90), "ui/src/x.ts": Fraction(175, 2), "shell/": Fraction(0)},
        )

    def test_empty_forms(self) -> None:
        self.assertEqual(covergate.parse_config(""), {})
        self.assertEqual(covergate.parse_config("# только комментарий\n"), {})
        self.assertEqual(covergate.parse_config("thresholds: {}\n"), {})
        self.assertEqual(covergate.parse_config("thresholds:\n"), {})

    def test_shipped_config_parses(self) -> None:
        text = (Path(__file__).resolve().parent.parent / "coverage.yaml").read_text(encoding="utf-8")
        self.assertIsInstance(covergate.parse_config(text), dict)


if __name__ == "__main__":
    unittest.main()
