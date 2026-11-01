# SPDX-License-Identifier: GPL-3.0-only
"""Тесты scripts/check_bundle_budget.py: настоящая «сборка» во временном каталоге."""
import contextlib
import io
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check_bundle_budget as budget  # noqa: E402

INDEX = """<!doctype html><html><head>
<script type="module" crossorigin src="/assets/index-AAA.js"></script>
{extra}
<link rel="stylesheet" crossorigin href="/assets/index-AAA.css">
</head><body><div id="root"></div></body></html>"""


def noise(n: int) -> str:
    """JS-комментарий из n случайных байт (hex): gzip-размер около n байт."""
    return "/*" + os.urandom(n).hex() + "*/"


class BudgetCase(unittest.TestCase):
    def setUp(self) -> None:
        self.dist = Path(tempfile.mkdtemp(prefix="bundle-budget-"))
        self.addCleanup(shutil.rmtree, self.dist, ignore_errors=True)
        (self.dist / "assets").mkdir()

    def put(self, rel: str, text: str) -> None:
        (self.dist / rel).write_text(text, encoding="utf-8", newline="\n")

    def index(self, extra: str = "") -> None:
        self.put("index.html", INDEX.format(extra=extra))

    def run_main(self, *extra: str) -> tuple[int, str]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = budget.main(["--dist", str(self.dist), *extra])
        return code, out.getvalue()


class VerdictTest(BudgetCase):
    def test_entry_within_budget_passes(self) -> None:
        self.index()
        self.put("assets/index-AAA.js", "console.log(1);" + noise(20_000))
        code, out = self.run_main()
        self.assertEqual(code, 0, out)
        self.assertIn("в бюджете", out)

    def test_entry_over_budget_fails(self) -> None:
        self.index()
        self.put("assets/index-AAA.js", noise(300 * 1024))
        code, out = self.run_main()
        self.assertEqual(code, 1, out)
        self.assertIn("ПРЕВЫШЕН", out)

    def test_custom_limit(self) -> None:
        self.index()
        self.put("assets/index-AAA.js", noise(40_000))
        self.assertEqual(self.run_main("--limit-kib", "100")[0], 0)
        self.assertEqual(self.run_main("--limit-kib", "10")[0], 1)


class EagerSetTest(BudgetCase):
    def test_modulepreload_counts_toward_the_sum(self) -> None:
        # Вынос кода в vendor-чанк, который подключён при старте, бюджет не снижает.
        self.index('<link rel="modulepreload" crossorigin href="/assets/vendor-BBB.js">')
        self.put("assets/index-AAA.js", "console.log(1);")
        self.put("assets/vendor-BBB.js", noise(300 * 1024))
        code, out = self.run_main()
        self.assertEqual(code, 1, out)
        self.assertIn("vendor-BBB.js", out)

    def test_static_imports_are_followed_transitively(self) -> None:
        self.index()
        self.put("assets/index-AAA.js", 'import{a as b}from"./mid-CCC.js";console.log(b);')
        self.put("assets/mid-CCC.js", 'import"./leaf-DDD.js";export const a=1;')
        self.put("assets/leaf-DDD.js", noise(300 * 1024))
        code, out = self.run_main()
        self.assertEqual(code, 1, out)
        self.assertIn("leaf-DDD.js", out)

    def test_dynamic_imports_are_not_counted(self) -> None:
        self.index()
        self.put(
            "assets/index-AAA.js",
            'const load=()=>import("./screen-EEE.js");const d=()=>import("./dict-FFF.js");',
        )
        self.put("assets/screen-EEE.js", noise(300 * 1024))
        self.put("assets/dict-FFF.js", noise(300 * 1024))
        code, out = self.run_main()
        self.assertEqual(code, 0, out)
        self.assertNotIn("screen-EEE.js", out)

    def test_each_file_is_counted_once(self) -> None:
        self.index('<link rel="modulepreload" href="/assets/index-AAA.js">')
        self.put("assets/index-AAA.js", noise(30_000))
        _, out = self.run_main()
        self.assertEqual(out.count("index-AAA.js"), 1)

    def test_relative_references_resolve(self) -> None:
        (self.dist / "index.html").write_text(
            '<script type="module" src="./assets/index-AAA.js"></script>', encoding="utf-8"
        )
        self.put("assets/index-AAA.js", noise(20_000))
        self.assertEqual(self.run_main()[0], 0)

    def test_external_and_escaping_references_are_skipped(self) -> None:
        self.index(
            '<script type="module" src="https://cdn.example/x.js"></script>'
            '<link rel="modulepreload" href="/../outside.js">'
        )
        (self.dist.parent / "outside.js").write_text(noise(300 * 1024), encoding="utf-8")
        self.addCleanup((self.dist.parent / "outside.js").unlink)
        self.put("assets/index-AAA.js", "console.log(1);")
        code, out = self.run_main()
        self.assertEqual(code, 0, out)
        self.assertIn("пропущено", out)


class FailSafeTest(BudgetCase):
    def test_missing_index_is_an_error_not_a_pass(self) -> None:
        code, out = self.run_main()
        self.assertEqual(code, 2, out)

    def test_no_module_scripts_is_an_error_not_a_pass(self) -> None:
        self.put("index.html", "<html><body>пусто</body></html>")
        code, out = self.run_main()
        self.assertEqual(code, 2, out)

    def test_entry_file_missing_from_dist_is_an_error(self) -> None:
        self.index()  # index.html ссылается на index-AAA.js, а файла нет
        code, out = self.run_main()
        self.assertEqual(code, 2, out)


if __name__ == "__main__":
    unittest.main()
