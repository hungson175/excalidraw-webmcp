#!/usr/bin/env python3
"""Real-browser regression for the Canvas Agent/Excalidraw toolbar boundary."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page, sync_playwright


VIEWPORTS = (("desktop", 1440, 900), ("mobile", 390, 844))
TOOL_SELECTORS = {
    "rectangle": '[data-testid="toolbar-rectangle"]',
    "ellipse": '[data-testid="toolbar-ellipse"]',
    "arrow": '[data-testid="toolbar-arrow"]',
}
VIEWPORT_TOOLS = {"desktop": ("ellipse", "arrow"), "mobile": ("rectangle", "arrow")}


def intersects(first: dict[str, float], second: dict[str, float]) -> bool:
    return not (
        first["x"] + first["width"] <= second["x"]
        or second["x"] + second["width"] <= first["x"]
        or first["y"] + first["height"] <= second["y"]
        or second["y"] + second["height"] <= first["y"]
    )


def center_hit(page: Page, box: dict[str, float]) -> dict[str, str | None]:
    return page.evaluate(
        """([x, y]) => {
          const node = document.elementFromPoint(x, y);
          const owner = node?.closest('[data-testid]');
          return {
            tag: node?.tagName ?? null,
            className: typeof node?.className === 'string' ? node.className : null,
            testid: owner?.getAttribute('data-testid') ?? null,
          };
        }""",
        [box["x"] + box["width"] / 2, box["y"] + box["height"] / 2],
    )


def open_workspace(page: Page, url: str, first_tool: str) -> None:
    page.goto(url, wait_until="networkidle", timeout=45_000)
    page.get_by_role("button", name="Start drawing", exact=True).click()
    page.locator(".product-shell__workspace-nav").wait_for(state="visible")
    page.wait_for_timeout(1_000)
    page.locator(f"{TOOL_SELECTORS[first_tool]}:visible").wait_for(state="visible")


def run_viewport(page: Page, url: str, name: str, width: int, height: int) -> dict[str, Any]:
    page.set_viewport_size({"width": width, "height": height})
    checked_tools = VIEWPORT_TOOLS[name]
    open_workspace(page, url, checked_tools[0])

    nav = page.locator(".product-shell__workspace-nav")
    nav_box = nav.bounding_box()
    assert nav_box is not None
    result: dict[str, Any] = {
        "viewport": {"name": name, "width": width, "height": height},
        "nav": nav_box,
        "tools": {},
        "overflow": page.evaluate("document.documentElement.scrollWidth - innerWidth"),
        "failures": [],
    }

    for tool_name in checked_tools:
        selector = TOOL_SELECTORS[tool_name]
        tool = page.locator(f"{selector}:visible").last
        box = tool.bounding_box()
        assert box is not None
        hit = center_hit(page, box)
        overlap = intersects(nav_box, box)
        activation_error = None
        try:
            tool.click(timeout=3_000)
        except PlaywrightError as error:
            activation_error = str(error).splitlines()[0]
        selected = tool.get_attribute("aria-pressed") == "true"
        result["tools"][tool_name] = {
            "box": box,
            "center_hit": hit,
            "intersects_nav": overlap,
            "pointer_error": activation_error,
            "selected": selected,
        }
        if overlap:
            result["failures"].append(f"{tool_name}:intersects-nav")
        if hit["testid"] != f"toolbar-{tool_name}":
            result["failures"].append(f"{tool_name}:center-hit-{hit['testid']}")
        if activation_error or not selected:
            result["failures"].append(f"{tool_name}:pointer-activation")

    if result["overflow"] > 0:
        result["failures"].append(f"horizontal-overflow:{result['overflow']}")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="https://hungson175.github.io/excalidraw-webmcp/")
    parser.add_argument("--chrome", default="/usr/bin/google-chrome")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    results: list[dict[str, Any]] = []
    errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=args.chrome,
            headless=True,
            chromium_sandbox=True,
        )
        context = browser.new_context()
        for name, width, height in VIEWPORTS:
            page = context.new_page()
            page.on("console", lambda message: errors.append(f"console:{message.type}:{message.text}") if message.type == "error" else None)
            page.on("pageerror", lambda error: errors.append(f"pageerror:{error}"))
            results.append(run_viewport(page, args.url, name, width, height))
            page.close()
        browser.close()

    payload = {
        "url": args.url,
        "chrome": args.chrome,
        "results": results,
        "browser_errors": errors,
    }
    rendered = json.dumps(payload, indent=2, sort_keys=True)
    print(rendered)
    if args.output:
        args.output.write_text(rendered + "\n")

    failures = [failure for result in results for failure in result["failures"]]
    failures.extend(errors)
    if failures:
        print(f"WORKSPACE_NAV_COLLISION=FAIL ({', '.join(failures)})")
        return 1
    print("WORKSPACE_NAV_COLLISION=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
