import { describe, expect, it, vi } from "vitest";

import { computeEvenGaps } from "../distribute_shapes";
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
};

const element = (
  id: string,
  x: number,
  y: number,
  width = 80,
  height = 40,
): TestElement => ({
  id,
  type: "rectangle",
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
    element("service-a", 10, 10, 80),
    element("service-b", 90, 90, 100),
    element("service-c", 180, 180, 70),
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
  };
};

const signal = () => new AbortController().signal;

describe("distribute_shapes", () => {
  it("publishes a strict bounded fifth descriptor without a commit alias", () => {
    const { api } = makeApi();
    const controller = createRetrofitController(api as never);
    const descriptors = controller.listTools();
    const descriptor = descriptors.find(
      ({ name }) => name === "distribute_shapes",
    );

    expect(descriptors.map(({ name }) => name)).toEqual([
      "select_shapes",
      "align_shapes",
      "equalize_size",
      "distribute_shapes",
      "connect_shapes",
      "create_shapes",
    ]);
    expect(descriptor).toMatchObject({
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object",
        required: ["axis"],
        additionalProperties: false,
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            maxItems: 240,
          },
          axis: { type: "string", enum: ["horizontal", "vertical"] },
        },
      },
    });
    expect(descriptor?.description.length).toBeLessThanOrEqual(500);
    expect(JSON.stringify(descriptor).length).toBeLessThanOrEqual(768);
    expect(
      descriptors.every(
        ({ name }) => !/commit|accept|reject|discard/i.test(name),
      ),
    ).toBe(true);
  });

  it("preserves endpoint bounds and composes vertical distribution after pending layout", async () => {
    const horizontal = computeEvenGaps(
      [
        { id: "a", x: 10, y: 0, width: 80, height: 40 },
        { id: "b", x: 90, y: 0, width: 80, height: 40 },
        { id: "c", x: 180, y: 0, width: 80, height: 40 },
      ],
      "horizontal",
    );
    expect(horizontal).toMatchObject({
      gap: 5,
      positioned: [{ x: 10 }, { x: 95 }, { x: 180 }],
    });

    const fixture = makeApi();
    const original = structuredClone(fixture.getElements());
    const controller = createRetrofitController(fixture.api as never);
    const ids = ["service-a", "service-b", "service-c"];

    await controller.executeTool(
      "align_shapes",
      { ids, edge: "left", to: "first" },
      { signal: signal() },
    );
    await controller.executeTool(
      "equalize_size",
      { ids, dimension: "width", mode: "max" },
      { signal: signal() },
    );
    const result = await controller.executeTool(
      "distribute_shapes",
      { ids, axis: "vertical" },
      { signal: signal() },
    );

    expect(result).toMatchObject({
      ok: true,
      status: "uncommitted",
      changedCount: 1,
      changedIds: ["service-b"],
    });
    expect(fixture.getElements()).toEqual(original);
    expect(fixture.updateScene).not.toHaveBeenCalled();
    const pending = controller.getSnapshot().pending;
    expect(pending?.elements.map(({ x }) => x)).toEqual([10, 10, 10]);
    expect(pending?.elements.map(({ width }) => width)).toEqual([
      100, 100, 100,
    ]);
    expect(pending?.elements.map(({ y }) => y)).toEqual([10, 95, 180]);
    expect(pending?.operations).toEqual([
      "align_shapes",
      "equalize_size",
      "distribute_shapes",
    ]);
    expect(controller.getSnapshot().ledger.at(-1)).toMatchObject({
      tool: "distribute_shapes",
      changedIds: ["service-b"],
      outcome: "uncommitted",
    });
  });

  it("refuses invalid, unsafe, overlapping, already-even, and aborted work without delta", async () => {
    const cases: Array<{
      initial?: TestElement[];
      args: unknown;
      reason: string;
      message?: RegExp;
    }> = [
      { args: { ids: [], axis: "vertical" }, reason: "no_selection" },
      {
        args: { ids: ["service-a", "service-b"], axis: "vertical" },
        reason: "unsafe_retry",
      },
      {
        args: { ids: ["service-a", "service-b", "service-c"] },
        reason: "invalid_args",
      },
      {
        args: {
          ids: ["service-a", "service-b", "service-c"],
          axis: "diagonal",
        },
        reason: "invalid_args",
      },
      {
        args: {
          ids: ["service-a", "service-b", "service-c"],
          axis: "vertical",
          to: "selection",
        },
        reason: "invalid_args",
      },
      {
        args: {
          ids: ["service-a", "service-a", "service-c"],
          axis: "vertical",
        },
        reason: "invalid_args",
      },
      {
        args: {
          ids: ["__proto__", "service-b", "service-c"],
          axis: "vertical",
        },
        reason: "invalid_args",
      },
      {
        initial: [
          element("service-a", 10, 10),
          element("service-b", 10, 20),
          element("service-c", 10, 30),
        ],
        args: {
          ids: ["service-a", "service-b", "service-c"],
          axis: "vertical",
        },
        reason: "unsafe_retry",
        message: /overlap/i,
      },
      {
        initial: [
          element("service-a", 10, 10),
          element("service-b", 10, 95),
          element("service-c", 10, 180),
        ],
        args: {
          ids: ["service-a", "service-b", "service-c"],
          axis: "vertical",
        },
        reason: "unsafe_retry",
        message: /already even/i,
      },
    ];

    for (const testCase of cases) {
      const fixture = makeApi(testCase.initial);
      const controller = createRetrofitController(fixture.api as never);
      const beforeScene = structuredClone(fixture.getElements());
      const beforeSnapshot = controller.getSnapshot();
      const result = await controller.executeTool(
        "distribute_shapes",
        testCase.args,
        { signal: signal() },
      );

      expect(result).toMatchObject({ ok: false, reason: testCase.reason });
      if (testCase.message) {
        expect((result as { message: string }).message).toMatch(
          testCase.message,
        );
      }
      expect(fixture.getElements()).toEqual(beforeScene);
      expect(controller.getSnapshot()).toEqual(beforeSnapshot);
      expect(fixture.updateScene).not.toHaveBeenCalled();
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(1536);
    }

    const fixture = makeApi();
    const controller = createRetrofitController(fixture.api as never);
    const abort = new AbortController();
    abort.abort();
    await expect(
      controller.executeTool(
        "distribute_shapes",
        {
          ids: ["service-a", "service-b", "service-c"],
          axis: "vertical",
        },
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
});
