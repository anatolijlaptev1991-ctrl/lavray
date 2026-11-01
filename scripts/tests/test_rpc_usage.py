# SPDX-License-Identifier: GPL-3.0-only
"""Тесты scripts/rpc_usage.py: настоящие файлы во временном каталоге."""
import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import rpc_usage  # noqa: E402

PROTO = """
service ProfileService {
  rpc ListProfiles(A) returns (B);
  rpc MoveProfiles(A) returns (B);
}
service LogService {
  rpc Subscribe(A) returns (stream B);
}
service StatsService {
  rpc Subscribe(A) returns (stream B);
}
"""

ALLOW_HEAD = "export const RPC_UNUSED_ALLOWED: Readonly<Record<string, string>> = {\n"


class RpcUsageCase(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="rpc-usage-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.put("proto/lavray.proto", PROTO)
        self.allow({})

    def put(self, rel: str, text: str) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")

    def allow(self, entries: dict[str, str]) -> None:
        body = "".join(f"  '{rpc}': '{why}',\n" for rpc, why in entries.items())
        self.put("ui/src/rpc-unused.allow.ts", ALLOW_HEAD + body + "};\n")

    def run_main(self, *extra: str) -> tuple[int, str]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = rpc_usage.main(["--root", str(self.root), *extra])
        return code, out.getvalue()

    def test_parses_services_and_same_named_methods(self) -> None:
        self.assertEqual(
            rpc_usage.rpcs(PROTO),
            ["ProfileService/ListProfiles", "ProfileService/MoveProfiles", "LogService/Subscribe", "StatsService/Subscribe"],
        )

    def test_unused_rpc_without_reason_fails(self) -> None:
        self.put("ui/src/a.ts", "core.profiles.listProfiles({});\nlogs.subscribe({});\nstats.subscribe({});\n")
        code, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("ProfileService/MoveProfiles", out)
        self.assertNotIn("ListProfiles", out)

    def test_every_rpc_called_passes(self) -> None:
        self.put(
            "ui/src/a.tsx",
            "core.profiles.listProfiles({});\nawait c.profiles.moveProfiles({});\nx.logs.subscribe({});\nx.stats.subscribe({});\n",
        )
        code, out = self.run_main()
        self.assertEqual(code, 0, out)

    def test_same_method_name_in_two_services_is_told_apart(self) -> None:
        self.allow({"ProfileService/ListProfiles": "agents only: reason"})
        self.put("ui/src/a.ts", "core.profiles.moveProfiles({});\nx.logs.subscribe({});\n")
        code, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("StatsService/Subscribe", out)
        self.assertNotIn("LogService/Subscribe", out)

    def test_allowed_with_reason_passes(self) -> None:
        self.allow({"ProfileService/ListProfiles": "нужен агентам и headless", "ProfileService/MoveProfiles": "нет в дизайне окна"})
        self.put("ui/src/a.ts", "x.logs.subscribe({});\nx.stats.subscribe({});\n")
        code, out = self.run_main()
        self.assertEqual(code, 0, out)

    def test_stale_allow_entry_fails(self) -> None:
        self.allow({"ProfileService/MoveProfiles": "нет в дизайне окна"})
        self.put("ui/src/a.ts", "core.profiles.listProfiles({});\ncore.profiles.moveProfiles({});\nlogs.subscribe();\nstats.subscribe();\n")
        code, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("устарела", out)

    def test_allow_entry_for_unknown_rpc_or_without_reason_fails(self) -> None:
        self.allow({"ProfileService/NoSuch": "не существует давно", "ProfileService/MoveProfiles": "коротко"})
        self.put("ui/src/a.ts", "core.profiles.listProfiles({});\nlogs.subscribe();\nstats.subscribe();\n")
        code, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("такого RPC нет", out)
        self.assertIn("нет внятной причины", out)

    def test_calls_in_tests_and_generated_code_do_not_count(self) -> None:
        self.put("ui/src/a.test.ts", "core.profiles.moveProfiles({});\n")
        self.put("ui/src/gen/x.ts", "core.profiles.moveProfiles({});\n")
        self.put("ui/src/test-utils/y.ts", "core.profiles.moveProfiles({});\n")
        self.put("ui/src/a.ts", "core.profiles.listProfiles({});\nlogs.subscribe();\nstats.subscribe();\n")
        code, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("MoveProfiles", out)

    def test_list_option_prints_unused(self) -> None:
        self.put("ui/src/a.ts", "core.profiles.listProfiles({});\n")
        code, out = self.run_main("--list")
        self.assertEqual(code, 0)
        self.assertEqual(out.split(), ["ProfileService/MoveProfiles", "LogService/Subscribe", "StatsService/Subscribe"])

    def test_repository_itself_is_clean(self) -> None:
        repo = Path(__file__).resolve().parents[2]
        self.assertEqual(rpc_usage.problems(repo), [])


if __name__ == "__main__":
    unittest.main()
