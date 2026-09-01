import { describe, expect, it, vi } from "vitest";

import type { ExcalidrawArrowElement } from "@excalidraw/element/types";

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
  boundElements?: Array<{ id: string; type: "arrow" }> | null;
  startBinding?: {
    elementId: string;
    fixedPoint: [number, number];
    mode: string;
  } | null;
  endBinding?: {
    elementId: string;
    fixedPoint: [number, number];
    mode: string;
  } | null;
  points?: Array<[number, number]>;
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
  boundElements: null,
});

const fixtureElements = () => [
  element("service-a", 10, 10, 60, 30),
  element("service-b", 90, 90, 80, 40),
  element("service-c", 180, 170, 100, 50),
  element("gateway", 500, 100, 120, 80, "diamond"),
];

const makeApi = (initial = fixtureElements()) => {
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

type Point = readonly [number, number];

const absoluteArrowEndpoint = (
  arrow: ExcalidrawArrowElement,
  end: "start" | "end",
): Point => {
  const point = arrow.points[end === "start" ? 0 : arrow.points.length - 1];
  return [arrow.x + point[0], arrow.y + point[1]];
};

const boundaryRatio = (shape: TestElement, point: Point) => {
  const centerX = shape.x + shape.width / 2;
  const centerY = shape.y + shape.height / 2;
  const deltaX = point[0] - centerX;
  const deltaY = point[1] - centerY;
  const cos = Math.cos(shape.angle);
  const sin = Math.sin(shape.angle);
  const localX = cos * deltaX + sin * deltaY;
  const localY = -sin * deltaX + cos * deltaY;
  const normalizedX = Math.abs(localX) / (shape.width / 2);
  const normalizedY = Math.abs(localY) / (shape.height / 2);

  switch (shape.type) {
    case "ellipse":
      return Math.hypot(normalizedX, normalizedY);
    case "diamond":
      return normalizedX + normalizedY;
    default:
      return Math.max(normalizedX, normalizedY);
  }
};

describe("connect_shapes", () => {
  it("publishes a strict bounded fourth tool without a commit alias", () => {
    const { api } = makeApi();
    const descriptor = createRetrofitController(api as never)
      .listTools()
      .find(({ name }) => name === "connect_shapes");

    expect(descriptor).toMatchObject({
      name: "connect_shapes",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object",
        required: ["sourceIds", "targetId"],
        additionalProperties: false,
        properties: {
          sourceIds: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 40,
            uniqueItems: true,
          },
          targetId: { type: "string" },
        },
      },
    });
    expect(
      createRetrofitController(api as never)
        .listTools()
        .every(({ name }) => !/commit|accept|reject|discard/i.test(name)),
    ).toBe(true);
  });

  it("rejects missing, unknown-key, duplicate, self, and over-limit requests", async () => {
    const { api } = makeApi();
    const controller = createRetrofitController(api as never);

    const invalidRequests = [
      {},
      { sourceIds: ["service-a"], targetId: "gateway", extra: true },
      {
        sourceIds: ["service-a", "service-a"],
        targetId: "gateway",
      },
      { sourceIds: ["gateway"], targetId: "gateway" },
      {
        sourceIds: Array.from({ length: 41 }, (_, index) => `shape-${index}`),
        targetId: "gateway",
      },
    ];
    for (const args of invalidRequests) {
      await expect(
        controller.executeTool("connect_shapes", args, { signal: signal() }),
      ).resolves.toMatchObject({ ok: false, reason: "invalid_args" });
    }
    expect(controller.getSnapshot().pending).toBeNull();
  });

  it("fails closed for unknown, locked, deleted, and non-bindable shapes", async () => {
    const fixture = makeApi();
    const controller = createRetrofitController(fixture.api as never);

    await expect(
      controller.executeTool(
        "connect_shapes",
        { sourceIds: ["missing"], targetId: "gateway" },
        { signal: signal() },
      ),
    ).resolves.toMatchObject({ ok: false, reason: "not_found" });

    fixture.replaceElement("service-a", { locked: true });
    await expect(
      controller.executeTool(
        "connect_shapes",
        { sourceIds: ["service-a"], targetId: "gateway" },
        { signal: signal() },
      ),
    ).resolves.toMatchObject({ ok: false, reason: "unsafe_retry" });

    fixture.replaceElement("service-a", { locked: false, isDeleted: true });
    await expect(
      controller.executeTool(
        "connect_shapes",
        { sourceIds: ["service-a"], targetId: "gateway" },
        { signal: signal() },
      ),
    ).resolves.toMatchObject({ ok: false });

    fixture.replaceElement("service-a", {
      isDeleted: false,
      type: "freedraw",
    });
    await expect(
      controller.executeTool(
        "connect_shapes",
        { sourceIds: ["service-a"], targetId: "gateway" },
        { signal: signal() },
      ),
    ).resolves.toMatchObject({ ok: false, reason: "unsafe_retry" });
  });

  it("composes arrows against pending geometry without changing the live scene", async () => {
    const fixture = makeApi();
    const original = structuredClone(fixture.getElements());
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
    await controller.executeTool(
      "equalize_size",
      {
        ids: ["service-a", "service-b", "service-c"],
        dimension: "width",
        mode: "max",
      },
      { signal: signal() },
    );
    const result = await controller.executeTool(
      "connect_shapes",
      {
        sourceIds: ["service-a", "service-b", "service-c"],
        targetId: "gateway",
      },
      { signal: signal() },
    );

    expect(result).toMatchObject({
      ok: true,
      status: "uncommitted",
      connectorCount: 3,
    });
    expect(fixture.getElements()).toEqual(original);
    expect(fixture.updateScene).not.toHaveBeenCalled();

    const pending = controller.getSnapshot().pending;
    const arrows = pending?.elements.filter(
      (element): element is ExcalidrawArrowElement => element.type === "arrow",
    );
    expect(arrows).toHaveLength(3);
    expect(pending?.operations).toEqual([
      "align_shapes",
      "equalize_size",
      "connect_shapes",
    ]);
    expect(
      pending?.elements
        .filter(({ id }) => id.startsWith("service-"))
        .map(({ x, width }) => ({ x, width })),
    ).toEqual([
      { x: 10, width: 100 },
      { x: 10, width: 100 },
      { x: 10, width: 100 },
    ]);
    expect(
      arrows?.every(
        (arrow) =>
          arrow.startBinding?.elementId.startsWith("service-") &&
          arrow.endBinding?.elementId === "gateway" &&
          arrow.startBinding.fixedPoint.length === 2 &&
          arrow.endBinding.fixedPoint.length === 2 &&
          arrow.startBinding.mode === "orbit" &&
          arrow.endBinding.mode === "orbit" &&
          (arrow.points?.length ?? 0) >= 2,
      ),
    ).toBe(true);
  });

  it("anchors connector endpoints on rotated shape boundaries instead of their centers", async () => {
    const rectangle = {
      ...element("rectangle-source", 20, 20, 120, 70),
      angle: Math.PI / 7,
    };
    const diamond = {
      ...element("diamond-source", 40, 260, 110, 90, "diamond"),
      angle: -Math.PI / 9,
    };
    const ellipse = {
      ...element("ellipse-target", 520, 130, 150, 100, "ellipse"),
      angle: Math.PI / 11,
    };
    const fixture = makeApi([rectangle, diamond, ellipse]);
    const controller = createRetrofitController(fixture.api as never);

    await expect(
      controller.executeTool(
        "connect_shapes",
        {
          sourceIds: [rectangle.id, diamond.id],
          targetId: ellipse.id,
        },
        { signal: signal() },
      ),
    ).resolves.toMatchObject({ ok: true, connectorCount: 2 });

    const pending = controller.getSnapshot().pending;
    const arrows = pending?.elements.filter(
      (candidate): candidate is ExcalidrawArrowElement =>
        candidate.type === "arrow",
    );
    expect(arrows).toHaveLength(2);

    const shapes = new Map(
      [rectangle, diamond, ellipse].map((shape) => [shape.id, shape]),
    );
    for (const arrow of arrows ?? []) {
      const source = shapes.get(arrow.startBinding!.elementId)!;
      const target = shapes.get(arrow.endBinding!.elementId)!;

      expect(
        boundaryRatio(source, absoluteArrowEndpoint(arrow, "start")),
      ).toBeCloseTo(1, 1);
      expect(
        boundaryRatio(target, absoluteArrowEndpoint(arrow, "end")),
      ).toBeCloseTo(1, 1);
      expect(arrow.startBinding?.fixedPoint).not.toEqual([0.5, 0.5]);
      expect(arrow.endBinding?.fixedPoint).not.toEqual([0.5, 0.5]);
    }
    expect(fixture.updateScene).not.toHaveBeenCalled();
  });

  it("commits bound arrows and mirrored container references atomically", async () => {
    const fixture = makeApi();
    const controller = createRetrofitController(fixture.api as never);
    await controller.executeTool(
      "connect_shapes",
      {
        sourceIds: ["service-a", "service-b", "service-c"],
        targetId: "gateway",
      },
      { signal: signal() },
    );

    const before = structuredClone(fixture.getElements());
    const committed = controller.commitFromHuman({ isTrusted: true });
    expect(committed).toMatchObject({ ok: true });
    expect(fixture.updateScene).toHaveBeenCalledTimes(1);
    expect(before).toHaveLength(4);
    expect(fixture.getElements()).toHaveLength(7);

    const arrows = fixture.getElements().filter(({ type }) => type === "arrow");
    expect(arrows).toHaveLength(3);
    for (const arrow of arrows) {
      const source = fixture
        .getElements()
        .find(({ id }) => id === arrow.startBinding?.elementId);
      const target = fixture
        .getElements()
        .find(({ id }) => id === arrow.endBinding?.elementId);
      expect(source?.boundElements).toContainEqual({
        id: arrow.id,
        type: "arrow",
      });
      expect(target?.boundElements).toContainEqual({
        id: arrow.id,
        type: "arrow",
      });
    }
    expect(controller.getSnapshot().pending).toBeNull();
  });

  it("refuses duplicate connector pairs in live or pending state", async () => {
    const fixture = makeApi();
    const controller = createRetrofitController(fixture.api as never);
    const args = { sourceIds: ["service-a"], targetId: "gateway" };

    await expect(
      controller.executeTool("connect_shapes", args, { signal: signal() }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      controller.executeTool("connect_shapes", args, { signal: signal() }),
    ).resolves.toMatchObject({ ok: false, reason: "unsafe_retry" });
  });

  it("requires a trusted commit and refuses stale shapes without a partial update", async () => {
    const fixture = makeApi();
    const controller = createRetrofitController(fixture.api as never);
    await controller.executeTool(
      "connect_shapes",
      { sourceIds: ["service-a", "service-b"], targetId: "gateway" },
      { signal: signal() },
    );

    expect(controller.commitFromHuman({ isTrusted: false })).toEqual({
      ok: false,
      reason: "human_gesture_required",
    });
    fixture.replaceElement("gateway", { version: 2, versionNonce: 999 });
    expect(controller.commitFromHuman({ isTrusted: true })).toEqual({
      ok: false,
      reason: "unsafe_retry",
    });
    expect(fixture.updateScene).not.toHaveBeenCalled();
    expect(fixture.getElements()).toHaveLength(4);
  });

  it("discard removes every staged connector and records the human outcome", async () => {
    const fixture = makeApi();
    const controller = createRetrofitController(fixture.api as never);
    await controller.executeTool(
      "connect_shapes",
      { sourceIds: ["service-a", "service-b"], targetId: "gateway" },
      { signal: signal() },
    );

    expect(controller.discardFromHuman({ isTrusted: true })).toMatchObject({
      ok: true,
    });
    expect(controller.getSnapshot().pending).toBeNull();
    expect(controller.getSnapshot().ledger.at(-1)).toMatchObject({
      tool: "human_discard",
      outcome: "discarded",
    });
    expect(fixture.updateScene).not.toHaveBeenCalled();
  });

  it("aborts without mutating scene, pending state, selection, or ledger", async () => {
    const fixture = makeApi();
    const controller = createRetrofitController(fixture.api as never);
    const abort = new AbortController();
    abort.abort();

    await expect(
      controller.executeTool(
        "connect_shapes",
        { sourceIds: ["service-a"], targetId: "gateway" },
        { signal: abort.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(controller.getSnapshot()).toEqual({
      selectedIds: [],
      pending: null,
      ledger: [],
    });
    expect(fixture.updateScene).not.toHaveBeenCalled();
  });

  it("keeps a successful forty-source response within the registry bound", async () => {
    const sources = Array.from({ length: 40 }, (_, index) =>
      element(`service-${index}`, index * 12, index * 8, 60, 30),
    );
    const fixture = makeApi([
      ...sources,
      element("gateway", 800, 200, 120, 80, "diamond"),
    ]);
    const controller = createRetrofitController(fixture.api as never);

    const result = await controller.executeTool(
      "connect_shapes",
      {
        sourceIds: sources.map(({ id }) => id),
        targetId: "gateway",
      },
      { signal: signal() },
    );

    expect(result).toMatchObject({
      ok: true,
      connectorCount: 40,
      changedCount: 40,
      truncated: false,
    });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1536);
    expect(fixture.getElements()).toHaveLength(41);
    expect(fixture.updateScene).not.toHaveBeenCalled();
  });
});
