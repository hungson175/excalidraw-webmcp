import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("production entry assets are safe under a GitHub Pages project path", async () => {
  const html = await readFile(
    new URL("../excalidraw-app/build/index.html", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=["']\//i);
  assert.doesNotMatch(
    html,
    /<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']\//i,
  );
});
