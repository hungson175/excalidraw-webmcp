import { describe, expect, it, vi } from "vitest";

import { createRetrofitController } from "../retrofit_controller";

type TestElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  locked: boolean;
  angle: number;
  text?: string;
  containerId?: string | null;
};

const element = (
  id: string,
  x: number,
  y: number,
  width = 80,
  height = 40,
  type = "rectangle",
): TestElement => ({
  id,
  type,
  x,
  y,
  width,
  height,
  version: 1,
  versionNonce: 10,
  isDeleted: false,
  locked: false,
  angle: 0,
});

const makeApi = (
  initial = [
    element("service-a", 10, 10, 60, 30),
    element("service-b", 90, 90, 80, 40),
    element("service-c", 180, 170, 100, 50),
  ],
) => {
  let elements = initial;
  const updateScene = vi.fn((scene: { elements: TestElement[] }) => {
    elements = scene.elements;
  });

  return {
    api: {
      getSceneElements: () => elements,
      getAppState: () => ({
        selectedElementIds: {},
        width: 1200,
        height: 800,
        scrollX: 0,
        scrollY: 0,
        zoom: { value: 1 },
      }),
      updateScene,
    },
    getElements: () => elements,
    updateScene,
    replaceElement: (id: string, patch: Partial<TestElement>) => {
      elements = elements.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      );
    },
  };
};

const signal = () => new AbortController().signal;

describe("Excalidraw retrofit controller", () => {
  it("publishes a bounded four-tool registry without a commit tool", () => {
    const { api } = makeApi();
    const controller = createRetrofitController(api as never);
    const descriptors = controller.listTools();

    expect(descriptors.map(({ name }) => name)).toEqual([
      "select_shapes",
      "align_shapes",
      "equalize_size",
      "connect_shapes",
    ]);
    expect(
      descriptors.find(({ name }) => name === "select_shapes")?.annotations,
    ).toEqual({ readOnlyHint: true });
    expect(
      descriptors.every(({ name }) => !/commit|accept|reject/i.test(name)),
    ).toBe(true);
    expect(
      descriptors.every(
        (descriptor) => JSON.stringify(descriptor).length <= 768,
      ),
    ).toBe(true);
  });

  it("selects bounded scene objects into page-local state without mutating the host", async () => {
    const { api, updateScene } = makeApi();
    const controller = createRetrofitController(api as never);

    const result = await controller.executeTool(
      "select_shapes",
      { type: "rectangle" },
      { signal: signal() },
    );

    expect(result).toMatchObject({ ok: true, selectedCount: 3 });
    expect(controller.getSnapshot().selectedIds).toEqual([
      "service-a",
      "service-b",
      "service-c",
    ]);
    expect(updateScene).not.toHaveBeenCalled();

    const tooMany = Array.from({ length: 241 }, (_, index) => `shape-${index}`);
    await expect(
      controller.executeTool(
        "select_shapes",
        { ids: tooMany },
        { signal: signal() },
      ),
    ).resolves.toMatchObject({ ok: false, reason: "invalid_args" });
  });

  it("composes alignment and equalization in one ghost preview", async () => {
    const { api, getElements, updateScene } = makeApi();
    const controller = createRetrofitController(api as never);
    const original = structuredClone(getElements());

    await controller.executeTool(
      "select_shapes",
      { ids: ["service-a", "service-b", "service-c"] },
      { signal: signal() },
    );
    const aligned = await controller.executeTool(
      "align_shapes",
      { edge: "left", to: "first" },
      { signal: signal() },
    );
    const equalized = await controller.executeTool(
      "equalize_size",
      { dimension: "width", mode: "max" },
      { signal: signal() },
    );

    expect(aligned).toMatchObject({ ok: true, status: "uncommitted" });
    expect(equalized).toMatchObject({ ok: true, status: "uncommitted" });
    expect(getElements()).toEqual(original);
    expect(updateScene).not.toHaveBeenCalled();

    const pending = controller.getSnapshot().pending;
    expect(pending?.elements.map(({ x }) => x)).toEqual([10, 10, 10]);
    expect(pending?.elements.map(({ width }) => width)).toEqual([
      100, 100, 100,
    ]);
    expect(pending?.operations).toEqual(["align_shapes", "equalize_size"]);
  });

  it("requires a trusted human gesture and revalidates target versions before commit", async () => {
    const fixture = makeApi();
    const controller = createRetrofitController(fixture.api as never);
    await controller.executeTool(
      "align_shapes",
      { ids: ["service-a", "service-b"], edge: "top", to: "first" },
      { signal: signal() },
    );

    expect(controller.commitFromHuman({ isTrusted: false })).toEqual({
      ok: false,
      reason: "human_gesture_required",
    });
    expect(fixture.updateScene).not.toHaveBeenCalled();

    fixture.replaceElement("service-a", { version: 2, x: 999 });
    expect(controller.commitFromHuman({ isTrusted: true })).toEqual({
      ok: false,
      reason: "unsafe_retry",
    });
    expect(fixture.updateScene).not.toHaveBeenCalled();
  });

  it("commits only changed geometry after a trusted human click", async () => {
    const fixture = makeApi();
    const controller = createRetrofitController(fixture.api as never);
    await controller.executeTool(
      "align_shapes",
      {
        ids: ["service-a", "service-b", "service-c"],
        edge: "left",
        to: "first",
      },
      { signal: signal() },
    );

    expect(controller.commitFromHuman({ isTrusted: true })).toEqual({
      ok: true,
      appliedIds: ["service-a", "service-b", "service-c"],
    });
    expect(fixture.updateScene).toHaveBeenCalledTimes(1);
    expect(fixture.getElements().map(({ x }) => x)).toEqual([10, 10, 10]);
    expect(controller.getSnapshot().pending).toBeNull();
    expect(controller.getSnapshot().ledger.at(-1)).toMatchObject({
      outcome: "committed",
    });
  });

  it("aborts before staging and leaves selection, preview, scene, and ledger untouched", async () => {
    const fixture = makeApi();
    const controller = createRetrofitController(fixture.api as never);
    const abort = new AbortController();
    abort.abort();

    await expect(
      controller.executeTool(
        "align_shapes",
        { ids: ["service-a", "service-b"], edge: "left", to: "first" },
        { signal: abort.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(controller.getSnapshot()).toMatchObject({
      selectedIds: [],
      pending: null,
      ledger: [],
    });
    expect(fixture.updateScene).not.toHaveBeenCalled();
  });

  it("fails closed on invalid or ambiguous geometry requests", async () => {
    const { api } = makeApi();
    const controller = createRetrofitController(api as never);

    await expect(
      controller.executeTool(
        "align_shapes",
        { ids: ["missing", "service-a"], edge: "sideways" },
        { signal: signal() },
      ),
    ).resolves.toMatchObject({ ok: false, reason: "invalid_args" });
    await expect(
      controller.executeTool(
        "equalize_size",
        { ids: ["service-a"], dimension: "width" },
        { signal: signal() },
      ),
    ).resolves.toMatchObject({ ok: false, reason: "unsafe_retry" });
    expect(controller.getSnapshot().pending).toBeNull();
  });
});
