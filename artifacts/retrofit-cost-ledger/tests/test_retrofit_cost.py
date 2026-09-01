import copy
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ARTIFACT_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
CONFIG_PATH = ARTIFACT_DIR / "config.json"
OUTPUT_PATH = REPO_ROOT / "RETROFIT.md"
sys.path.insert(0, str(ARTIFACT_DIR))

from generate_retrofit_md import (  # noqa: E402
    collect_snapshot,
    generate_report,
    load_config,
    write_report,
)


class RetrofitCostReportTests(unittest.TestCase):
    def test_config_pins_the_audited_snapshot_and_observed_clock(self):
        config = load_config(CONFIG_PATH, REPO_ROOT)

        self.assertEqual(
            config["pinned_base"],
            "e1bb9ff8f8931e783c11d104abb8967ac6605c9a",
        )
        self.assertEqual(
            config["public_head"],
            "59ca15861bde265f74d6785a0e4383b05fdc0caf",
        )
        self.assertEqual(config["observed_wall_clock"]["minutes"], 87)
        self.assertEqual(
            config["observed_wall_clock"]["label"],
            "agent-assisted elapsed time",
        )

    def test_diff_totals_equal_disjoint_category_totals(self):
        config = load_config(CONFIG_PATH, REPO_ROOT)
        snapshot = collect_snapshot(REPO_ROOT, config)

        self.assertEqual(snapshot["total"], {"files": 17, "added": 2689, "deleted": 0})
        self.assertEqual(
            snapshot["categories"],
            {
                "production": {"files": 8, "added": 1529, "deleted": 0},
                "test": {"files": 8, "added": 1145, "deleted": 0},
                "spike": {"files": 1, "added": 15, "deleted": 0},
            },
        )
        self.assertEqual(len(snapshot["rows"]), 17)

    def test_report_is_deterministic_public_bounded_and_truthful(self):
        first = generate_report(REPO_ROOT, CONFIG_PATH)
        second = generate_report(REPO_ROOT, CONFIG_PATH)

        self.assertEqual(first, second)
        self.assertLessEqual(len(first.split()), 900)
        for required in (
            "browser_api=PASS",
            "native_agent_invocation=UNPROVEN",
            "agent-assisted elapsed time",
            "convertToExcalidrawElements",
            "https://hungson175.github.io/excalidraw-webmcp/",
            "https://github.com/hungson175/excalidraw-webmcp/compare/",
        ):
            self.assertIn(required, first)
        self.assertEqual(first.count("native_agent_invocation=UNPROVEN"), 1)
        self.assertIsNone(re.search(r"[ \t]+$", first, re.MULTILINE))
        self.assertIsNone(
            re.search(
                r"Boss|session|worktree|/tmp/|receipt|TODO|PLACEHOLDER|TBD|\b\d+(?:\.\d+)?x faster\b",
                first,
                re.IGNORECASE,
            )
        )

    def test_unknown_or_overlapping_category_paths_fail_closed(self):
        raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        cases = []
        unknown = copy.deepcopy(raw)
        unknown["categories"]["production"].append("unknown/path.ts")
        cases.append(unknown)
        overlap = copy.deepcopy(raw)
        overlap["categories"]["test"].append(overlap["categories"]["production"][0])
        cases.append(overlap)

        with tempfile.TemporaryDirectory() as temp_dir:
            for index, invalid in enumerate(cases):
                path = Path(temp_dir) / f"invalid-{index}.json"
                path.write_text(json.dumps(invalid), encoding="utf-8")
                with self.assertRaises(ValueError):
                    collect_snapshot(REPO_ROOT, load_config(path, REPO_ROOT))

    def test_invalid_clock_preserves_existing_output(self):
        raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        raw["observed_wall_clock"]["start"] = "2026-09-01T10:18:00+07:00"
        raw["observed_wall_clock"]["end"] = "2026-09-01T08:51:00+07:00"

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "invalid-clock.json"
            output_path = Path(temp_dir) / "RETROFIT.md"
            config_path.write_text(json.dumps(raw), encoding="utf-8")
            output_path.write_text("sentinel\n", encoding="utf-8")

            with self.assertRaises(ValueError):
                write_report(REPO_ROOT, config_path, output_path)
            self.assertEqual(output_path.read_text(encoding="utf-8"), "sentinel\n")

    def test_one_command_check_matches_the_checked_in_page(self):
        result = subprocess.run(
            [
                sys.executable,
                str(ARTIFACT_DIR / "generate_retrofit_md.py"),
                "--config",
                str(CONFIG_PATH),
                "--output",
                str(OUTPUT_PATH),
                "--check",
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("RETROFIT_REPORT=PASS", result.stdout)

    def test_upstream_readme_points_cold_judges_to_the_evidence_page(self):
        readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("[WebMCP retrofit evidence](./RETROFIT.md)", readme)


if __name__ == "__main__":
    unittest.main()
