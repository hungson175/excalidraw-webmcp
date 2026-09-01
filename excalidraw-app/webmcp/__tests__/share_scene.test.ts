import { describe, expect, it } from "vitest";

import {
  decodeSharedScene,
  encodeSharedScene,
  shareFragment,
} from "../product/share_scene";

const scene = {
  elements: [
    {
      id: "node-a",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 60,
      isDeleted: false,
    },
  ],
  files: {},
};

describe("client-only share scene", () => {
  it("round-trips unicode through a bounded URL-safe fragment", () => {
    const token = encodeSharedScene({ ...scene, name: "Sơ đồ thanh toán" });
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSharedScene(token)).toEqual({
      ok: true,
      scene: { ...scene, name: "Sơ đồ thanh toán" },
    });
    expect(shareFragment(token)).toBe(`#view=workspace&share=${token}`);
  });

  it("refuses malformed, unsupported, and oversized input without throwing", () => {
    expect(decodeSharedScene("not-a-valid-payload")).toMatchObject({
      ok: false,
    });
    const unsupported = btoa(JSON.stringify({ version: 9, elements: [] }));
    expect(decodeSharedScene(unsupported)).toMatchObject({ ok: false });
    expect(() =>
      encodeSharedScene({
        ...scene,
        elements: Array.from({ length: 201 }, (_, index) => ({
          ...scene.elements[0],
          id: `node-${index}`,
        })),
      }),
    ).toThrow(/200/);
  });
});
