import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("WebMCP origin-trial delivery", () => {
  it("ships one first-party token before every script", () => {
    const source = readFileSync(
      join(process.cwd(), "excalidraw-app", "index.html"),
      "utf8",
    );
    const matches = Array.from(
      source.matchAll(/<meta\s+http-equiv="origin-trial"\s+content="([^"]+)"/g),
    );

    expect(matches).toHaveLength(1);
    const [match] = matches;
    expect(match.index).toBeLessThan(source.indexOf("<script"));
    expect(match[1]).not.toMatch(/placeholder|token/i);

    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    expect(decoded).toContain("https://hungson175.github.io:443");
    expect(decoded).toContain('"feature":"WebMCP"');
    expect(decoded).toContain('"expiry":1794873600');
  });
});
