import { beforeEach, describe, expect, it } from "vitest";

import { createLocalDiagramStore } from "../product/diagram_store";

const element = (id: string) => ({
  id,
  type: "rectangle",
  x: 10,
  y: 20,
  width: 100,
  height: 60,
  isDeleted: false,
});

describe("local-first diagram store", () => {
  beforeEach(() => localStorage.clear());

  it("exposes one replaceable async seam and round-trips save/list/load/rename/delete", async () => {
    const store = createLocalDiagramStore(localStorage, "test-diagrams");
    expect(Object.keys(store).sort()).toEqual([
      "delete",
      "list",
      "load",
      "rename",
      "save",
    ]);

    const saved = await store.save({
      name: "Checkout architecture",
      elements: [element("browser"), element("api")],
      files: {},
    });
    expect(saved.name).toBe("Checkout architecture");
    expect(saved.elementCount).toBe(2);
    expect(await store.list()).toEqual([saved]);
    expect(await store.load(saved.id)).toMatchObject({
      id: saved.id,
      name: "Checkout architecture",
      elements: [{ id: "browser" }, { id: "api" }],
    });

    expect(await store.rename(saved.id, "Checkout v2")).toMatchObject({
      id: saved.id,
      name: "Checkout v2",
    });
    expect((await store.load(saved.id))?.name).toBe("Checkout v2");
    expect(await store.delete(saved.id)).toBe(true);
    expect(await store.list()).toEqual([]);
    expect(await store.load(saved.id)).toBeNull();
  });

  it("fails closed on malformed storage and bounded input", async () => {
    const key = "test-diagrams";
    localStorage.setItem(key, "not json");
    const store = createLocalDiagramStore(localStorage, key);
    await expect(store.list()).resolves.toEqual([]);
    expect(localStorage.getItem(key)).toBe("not json");

    await expect(
      store.save({ name: " ", elements: [], files: {} }),
    ).rejects.toThrow(/name/i);
    await expect(
      store.save({
        name: "Large",
        elements: Array.from({ length: 501 }, (_, index) =>
          element(`shape-${index}`),
        ),
        files: {},
      }),
    ).rejects.toThrow(/500/);
    await expect(store.rename("missing", "Name")).resolves.toBeNull();
    await expect(store.delete("missing")).resolves.toBe(false);
  });
});
